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
const { docClient, GAMES_TABLE } = require('../shared/dynamodb');
const { 
  GameStatus,
  MAX_PLAYERS,
  buildResponse 
} = require('../shared/gameUtils');

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
 * Determine teams based on host and chosen partner
 * @param {number} hostSeat - Seat of host (should be 0)
 * @param {number} partnerSeat - Seat of chosen partner
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

    // Determine teams
    const teams = determineTeams(0, partnerSeat);

    // Update game state with teams and transition to BIDDING
    const result = await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId: normalizedGameId },
      UpdateExpression: `
        SET teams = :teams,
            #status = :newStatus,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':teams': teams,
        ':newStatus': GameStatus.BIDDING, // Move directly to bidding after partner selection
        ':one': 1,
        ':currentVersion': game.version,
        ':updatedAt': new Date().toISOString(),
      },
      ConditionExpression: 'version = :currentVersion',
      ReturnValues: 'ALL_NEW',
    }));

    const updatedGame = result.Attributes;

    console.log(`Host selected partner at seat ${partnerSeat} for game ${normalizedGameId}`);
    console.log(`Teams: Team 0 = [${teams.team0.join(', ')}], Team 1 = [${teams.team1.join(', ')}]`);

    // Return success response
    return buildResponse(200, {
      success: true,
      gameId: updatedGame.gameId,
      teams: updatedGame.teams,
      status: updatedGame.status,
      players: updatedGame.players,
      message: `Partner selected! Teams: Team 0 (${teams.team0.map(s => game.players.find(p => p.seat === s)?.name).join(' & ')}) vs Team 1 (${teams.team1.map(s => game.players.find(p => p.seat === s)?.name).join(' & ')})`,
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
