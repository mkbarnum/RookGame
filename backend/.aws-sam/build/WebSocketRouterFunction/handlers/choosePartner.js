/**
 * ChoosePartner Lambda Handler
 * 
 * Allows the host to select their partner once all 4 players have joined.
 * Sets teams and transitions game to PARTNER_SELECTION or BIDDING status.
 * 
 * HTTP API: POST /choosePartner
 * Request body: { "gameId": "ABCDEF", "partnerSeat": 2 }
 * Response: { "success": true, "teams": {...}, "status": "BIDDING" }
 */

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, CONNECTIONS_TABLE } = require('../shared/dynamodb');
const { 
  GameStatus,
  MAX_PLAYERS,
  buildResponse 
} = require('../shared/gameUtils');
const { dealGame } = require('../shared/dealUtils');
// Use local WebSocket in development, AWS API Gateway in production
const wsModule = process.env.DYNAMODB_ENDPOINT 
  ? require('../shared/websocketLocal')
  : require('../shared/websocket');
const { 
  createApiGatewayClient, 
  sendToPlayer, 
  broadcastToGame,
  getGameConnections
} = wsModule;

/**
 * Fetch game from DynamoDB
 * @param {string} gameId - Game code
 * @returns {Promise<object|null>} Game object or null if not found
 */
async function getGame(gameId) {
  const result = await docClient.send(new GetCommand({
    TableName: GAMES_TABLE,
    Key: { gameId },
  }));
  return result.Item || null;
}

/**
 * Rearrange seats so partners sit across from each other
 * Host (0) stays at bottom, partner moves to top (2)
 * @param {Array} players - Original players array
 * @param {number} partnerSeat - Original seat of chosen partner
 * @returns {Array} Rearranged players array with new seat assignments
 */
function rearrangeSeats(players, partnerSeat) {
  // Create a map of old seat -> new seat
  // Host (0) -> 0 (bottom)
  // Partner -> 2 (top, across from host)
  // Other two players -> 1 and 3 (left and right)
  
  const seatMapping = {
    0: 0, // Host stays at bottom
  };
  
  // Partner goes to top (seat 2)
  seatMapping[partnerSeat] = 2;
  
  // Find the other two players (not host, not partner)
  const otherSeats = [0, 1, 2, 3].filter(seat => seat !== 0 && seat !== partnerSeat);
  
  // Assign them to left (1) and right (3)
  seatMapping[otherSeats[0]] = 1;
  seatMapping[otherSeats[1]] = 3;
  
  // Rearrange players array with new seats
  const rearranged = players.map(player => ({
    ...player,
    seat: seatMapping[player.seat],
  }));
  
  return rearranged;
}

/**
 * Determine teams based on host and chosen partner
 * After seat rearrangement, host is 0 and partner is 2
 * @param {number} hostSeat - Seat of host (should be 0 after rearrangement)
 * @param {number} partnerSeat - Seat of chosen partner (should be 2 after rearrangement)
 * @returns {object} Teams object with team0 and team1 arrays
 */
function determineTeams(hostSeat, partnerSeat) {
  const allSeats = [0, 1, 2, 3];
  const team0 = [hostSeat, partnerSeat].sort((a, b) => a - b);
  const team1 = allSeats.filter(seat => !team0.includes(seat));
  
  return {
    team0,
    team1,
  };
}

/**
 * Lambda handler for choosing a partner
 * @param {object} event - API Gateway event
 * @returns {Promise<object>} HTTP response
 */
async function handler(event) {
  console.log('ChoosePartner event:', JSON.stringify(event));

  try {
    // Parse request body
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      return buildResponse(400, {
        error: 'Invalid request body',
        message: 'Request body must be valid JSON',
      });
    }

    // Validate required fields
    const { gameId, partnerSeat } = body || {};

    if (!gameId || typeof gameId !== 'string') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'gameId is required and must be a string',
      });
    }

    if (typeof partnerSeat !== 'number' || partnerSeat < 1 || partnerSeat > 3) {
      return buildResponse(400, {
        error: 'Invalid partnerSeat',
        message: 'partnerSeat must be a number between 1 and 3 (host is seat 0)',
      });
    }

    // Normalize game ID
    const normalizedGameId = gameId.trim().toUpperCase();

    // Fetch the current game state
    const game = await getGame(normalizedGameId);

    if (!game) {
      return buildResponse(404, {
        error: 'Game not found',
        message: `No game found with code: ${normalizedGameId}`,
      });
    }

    // Verify game is in correct state
    if (game.status !== GameStatus.FULL && game.status !== GameStatus.PARTNER_SELECTION) {
      return buildResponse(400, {
        error: 'Invalid game state',
        message: `Game is not ready for partner selection. Current status: ${game.status}`,
      });
    }

    // Verify game has 4 players
    if (!game.players || game.players.length !== MAX_PLAYERS) {
      return buildResponse(400, {
        error: 'Game not full',
        message: 'Game must have 4 players before selecting partner',
      });
    }

    // Verify host is making the request (seat 0)
    const hostPlayer = game.players.find(p => p.seat === 0);
    if (!hostPlayer) {
      return buildResponse(400, {
        error: 'Host not found',
        message: 'Game must have a host (seat 0)',
      });
    }

    // Verify partner seat is valid and not the host
    if (partnerSeat === 0) {
      return buildResponse(400, {
        error: 'Invalid partner',
        message: 'Host cannot select themselves as partner',
      });
    }

    const partnerPlayer = game.players.find(p => p.seat === partnerSeat);
    if (!partnerPlayer) {
      return buildResponse(400, {
        error: 'Invalid partner seat',
        message: `No player found at seat ${partnerSeat}`,
      });
    }

    // Rearrange seats so partners sit across from each other
    // Host (0) stays at bottom, partner moves to top (2)
    const rearrangedPlayers = rearrangeSeats(game.players, partnerSeat);
    
    // After rearrangement, partner is now at seat 2
    const newPartnerSeat = 2;
    
    // Determine teams (host is 0, partner is 2)
    const teams = determineTeams(0, newPartnerSeat);

    // Update connections table to reflect new seat assignments
    // We need to update the seat field for each connection
    const connections = await getGameConnections(normalizedGameId);
    const seatMapping = {};
    rearrangedPlayers.forEach(player => {
      const oldPlayer = game.players.find(p => p.name === player.name);
      if (oldPlayer) {
        seatMapping[oldPlayer.seat] = player.seat;
      }
    });

    // Update connections with new seat numbers
    // Note: In local development, connections are stored in-memory in server.js
    // In production, they're in DynamoDB. We update DynamoDB here, and the
    // local server will handle in-memory updates via the WebSocket message
    for (const conn of connections) {
      if (conn.seat !== null && conn.seat !== undefined && seatMapping[conn.seat] !== undefined) {
        const newSeat = seatMapping[conn.seat];
        // Update connection in DynamoDB
        try {
          await docClient.send(new UpdateCommand({
            TableName: CONNECTIONS_TABLE,
            Key: {
              gameId: normalizedGameId,
              connectionId: conn.connectionId,
            },
            UpdateExpression: 'SET #seat = :newSeat',
            ExpressionAttributeNames: {
              '#seat': 'seat',
            },
            ExpressionAttributeValues: {
              ':newSeat': newSeat,
            },
          }));
        } catch (error) {
          console.warn(`Failed to update connection ${conn.connectionId} seat:`, error);
        }
      }
    }
    
    // For local development, also update in-memory connections
    // The local WebSocket client will handle this when it receives the seatsRearranged message

    // Update game state with rearranged players and teams
    const result = await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId: normalizedGameId },
      UpdateExpression: `
        SET players = :players,
            teams = :teams,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeValues: {
        ':players': rearrangedPlayers,
        ':teams': teams,
        ':one': 1,
        ':currentVersion': game.version,
        ':updatedAt': new Date().toISOString(),
      },
      ConditionExpression: 'version = :currentVersion',
      ReturnValues: 'ALL_NEW',
    }));

    const updatedGame = result.Attributes;

    console.log(`[CHOOSE_PARTNER] Host selected partner at seat ${partnerSeat} for game ${normalizedGameId}`);
    console.log(`[CHOOSE_PARTNER] Teams: Team 0 = [${teams.team0.join(', ')}], Team 1 = [${teams.team1.join(', ')}]`);

    // Check that all players are connected via WebSocket before dealing
    // Note: connections was already fetched above, but we need to re-fetch after seat updates
    // to get the updated seat numbers
    const apiGatewayClient = createApiGatewayClient({});
    const connectionsAfterUpdate = await getGameConnections(normalizedGameId);
    
    console.log(`[CHOOSE_PARTNER] Connections after seat update:`, JSON.stringify(
      connectionsAfterUpdate.map(c => ({
        playerName: c.playerName,
        seat: c.seat,
        connectionId: c.connectionId?.slice(-8),
        connectedAt: c.connectedAt,
      }))
    ));
    
    // Get unique seats from connections (filter out null/undefined seats)
    const connectedSeats = new Set(
      connectionsAfterUpdate
        .map(conn => conn.seat)
        .filter(seat => seat !== null && seat !== undefined)
    );
    
    // Get bot seats (bots don't need WebSocket connections)
    const botSeats = new Set(
      rearrangedPlayers
        .filter(p => p.isBot === true)
        .map(p => p.seat)
    );
    
    console.log(`[CHOOSE_PARTNER] Connected seats: [${Array.from(connectedSeats).join(', ')}]`);
    console.log(`[CHOOSE_PARTNER] Bot seats: [${Array.from(botSeats).join(', ')}]`);
    
    // Check if all 4 players (seats 0-3) are either connected OR are bots
    const allSeatsReady = [0, 1, 2, 3].every(seat => 
      connectedSeats.has(seat) || botSeats.has(seat)
    );
    
    if (!allSeatsReady) {
      const missingSeats = [0, 1, 2, 3].filter(seat => 
        !connectedSeats.has(seat) && !botSeats.has(seat)
      );
      console.warn(`[CHOOSE_PARTNER] ⚠️ Not all players ready. Missing seats: ${missingSeats.join(', ')}`);
      console.warn(`[CHOOSE_PARTNER] Current connections:`, JSON.stringify(connectionsAfterUpdate.map(c => ({
        playerName: c.playerName,
        seat: c.seat,
        connectionId: c.connectionId?.slice(-8),
        isBot: c.isBot,
      }))));
      return buildResponse(400, {
        error: 'Not all players ready',
        message: `All players must be connected before dealing cards. Missing players at seats: ${missingSeats.join(', ')}. Please ensure all players have joined the game.`,
        connectedSeats: Array.from(connectedSeats),
        botSeats: Array.from(botSeats),
        missingSeats,
      });
    }

    console.log(`[CHOOSE_PARTNER] ✓ All 4 players ready (${connectedSeats.size} connected, ${botSeats.size} bots). Proceeding with deal.`);

    // For the first hand, dealer is seat 0 (host)
    // Set dealer in game state if not already set
    const firstDealer = 0;
    if (updatedGame.dealer === null || updatedGame.dealer === undefined) {
      await docClient.send(new UpdateCommand({
        TableName: GAMES_TABLE,
        Key: { gameId: normalizedGameId },
        UpdateExpression: 'SET dealer = :dealer',
        ExpressionAttributeValues: {
          ':dealer': firstDealer,
        },
      }));
    }

    // Now deal the cards (first hand, dealer is 0)
    const { hands, kitty } = await dealGame(normalizedGameId, updatedGame.version, firstDealer);

    // Send WebSocket messages to players
    try {
      // apiGatewayClient already created above
      console.log(`[CHOOSE_PARTNER] Starting WebSocket message delivery...`);

      // Send private hand messages to each player
      const dealResults = [];
      for (let seat = 0; seat < 4; seat++) {
        const handKey = `hand${seat}`;
        const playerCards = hands[handKey];
        
        console.log(`[CHOOSE_PARTNER] Sending deal to seat ${seat} (${playerCards.length} cards)...`);
        const result = await sendToPlayer(apiGatewayClient, normalizedGameId, seat, {
          action: 'deal',
          cards: playerCards,
        });
        dealResults.push({ seat, success: result?.success, error: result?.error });
        console.log(`[CHOOSE_PARTNER] Deal to seat ${seat}: ${result?.success ? '✓' : '✗'} ${result?.error || ''}`);
      }
      
      console.log(`[CHOOSE_PARTNER] Deal results summary:`, JSON.stringify(dealResults));

      // Broadcast seat reassignment and bidding start messages
      console.log(`[CHOOSE_PARTNER] Broadcasting seatsRearranged...`);
      const seatsResult = await broadcastToGame(apiGatewayClient, normalizedGameId, {
        action: 'seatsRearranged',
        players: rearrangedPlayers,
        teams: teams,
      });
      console.log(`[CHOOSE_PARTNER] seatsRearranged: ${seatsResult.success}/${seatsResult.total} succeeded`);

      // Broadcast bidding start message to all players
      // For first hand, dealer is 0 (host), and dealer starts bidding
      const firstHandStartingPlayer = firstDealer;
      console.log(`[CHOOSE_PARTNER] Broadcasting biddingStart...`);
      const biddingResult = await broadcastToGame(apiGatewayClient, normalizedGameId, {
        action: 'biddingStart',
        startingPlayer: firstHandStartingPlayer,
        minBid: 50,
      });
      console.log(`[CHOOSE_PARTNER] biddingStart: ${biddingResult.success}/${biddingResult.total} succeeded`);

      console.log(`[CHOOSE_PARTNER] ✓ WebSocket message delivery complete`);
    } catch (wsError) {
      // Log but don't fail the request if WebSocket messaging fails
      // This allows the game to continue even if WebSocket is unavailable
      console.error(`[CHOOSE_PARTNER] ✗ Error sending WebSocket messages:`, wsError.message);
      console.error(`[CHOOSE_PARTNER] Stack:`, wsError.stack);
      console.log('[CHOOSE_PARTNER] Game state updated successfully, but WebSocket messages failed');
    }

    // Fetch updated game state after dealing
    const finalGame = await getGame(normalizedGameId);

    // Return success response
    return buildResponse(200, {
      success: true,
      gameId: finalGame.gameId,
      teams: finalGame.teams,
      status: finalGame.status,
      players: finalGame.players,
      message: `Partner selected and cards dealt! Teams: Team 0 (${teams.team0.map(s => game.players.find(p => p.seat === s)?.name).join(' & ')}) vs Team 1 (${teams.team1.map(s => game.players.find(p => p.seat === s)?.name).join(' & ')})`,
    });

  } catch (error) {
    console.error('Error choosing partner:', error);

    // Handle specific DynamoDB errors
    if (error.name === 'ConditionalCheckFailedException') {
      return buildResponse(409, {
        error: 'Concurrent update conflict',
        message: 'Game state changed, please refresh and try again',
      });
    }

    return buildResponse(500, {
      error: 'Internal server error',
      message: 'Failed to choose partner',
    });
  }
}

module.exports = { handler };
