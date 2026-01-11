/**
 * JoinGame Lambda Handler
 * 
 * Allows a player to join an existing game lobby.
 * Uses optimistic locking (version number) to handle concurrent joins.
 * Broadcasts playerJoined message to all connected players.
 * 
 * HTTP API: POST /joinGame
 * Request body: { "gameId": "ABCDEF", "playerName": "PlayerName" }
 * Response: { "seat": 1, "players": [...], "status": "LOBBY" }
 */

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE } = require('../shared/dynamodb');
const { 
  GameStatus,
  MAX_PLAYERS,
  getNextAvailableSeat, 
  isNameTaken,
  buildResponse 
} = require('../shared/gameUtils');

// Use local WebSocket in development, AWS API Gateway in production
const wsModule = process.env.DYNAMODB_ENDPOINT
  ? require('../shared/websocketLocal')
  : require('../shared/websocket');

const { createApiGatewayClient, broadcastToGame } = wsModule;

/**
 * Maximum retry attempts for optimistic locking conflicts
 */
const MAX_RETRY_ATTEMPTS = 3;

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
 * Attempt to add a player to a game with optimistic locking
 * @param {object} game - Current game state
 * @param {string} playerName - Name of player to add
 * @returns {Promise<object>} Updated game state
 * @throws {Error} If update fails
 */
async function addPlayerToGame(game, playerName) {
  const nextSeat = getNextAvailableSeat(game.players);
  
  if (nextSeat === null) {
    throw { code: 'GAME_FULL', message: 'Game is already full' };
  }

  // Determine new status (FULL if this is the 4th player)
  const newPlayerCount = game.players.length + 1;
  const newStatus = newPlayerCount >= MAX_PLAYERS ? GameStatus.FULL : game.status;

  // Build the update with optimistic locking
  const result = await docClient.send(new UpdateCommand({
    TableName: GAMES_TABLE,
    Key: { gameId: game.gameId },
    UpdateExpression: `
      SET players = list_append(players, :newPlayer),
          #status = :newStatus,
          version = :newVersion,
          updatedAt = :updatedAt
    `,
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':newPlayer': [{ seat: nextSeat, name: playerName }],
      ':newStatus': newStatus,
      ':newVersion': game.version + 1,
      ':currentVersion': game.version,
      ':updatedAt': new Date().toISOString(),
    },
    // Optimistic locking: only update if version matches
    ConditionExpression: 'version = :currentVersion',
    ReturnValues: 'ALL_NEW',
  }));

  return {
    ...result.Attributes,
    assignedSeat: nextSeat,
  };
}

/**
 * Lambda handler for joining a game
 * @param {object} event - API Gateway event
 * @returns {Promise<object>} HTTP response
 */
async function handler(event) {
  console.log('JoinGame event:', JSON.stringify(event));

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
    const { gameId, playerName } = body || {};

    if (!gameId || typeof gameId !== 'string') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'gameId is required and must be a string',
      });
    }

    if (!playerName || typeof playerName !== 'string') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'playerName is required and must be a string',
      });
    }

    // Normalize inputs
    const normalizedGameId = gameId.trim().toUpperCase();
    const trimmedPlayerName = playerName.trim();

    // Validate player name length
    if (trimmedPlayerName.length < 1 || trimmedPlayerName.length > 20) {
      return buildResponse(400, {
        error: 'Invalid playerName',
        message: 'playerName must be between 1 and 20 characters',
      });
    }

    // Retry loop for optimistic locking
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        // Fetch the current game state
        const game = await getGame(normalizedGameId);

        if (!game) {
          return buildResponse(404, {
            error: 'Game not found',
            message: `No game found with code: ${normalizedGameId}`,
          });
        }

        // Check if game is in a joinable state
        if (game.status !== GameStatus.LOBBY) {
          return buildResponse(400, {
            error: 'Cannot join game',
            message: game.status === GameStatus.FULL 
              ? 'Game is already full'
              : 'Game has already started',
          });
        }

        // Check if game is full
        if (game.players.length >= MAX_PLAYERS) {
          return buildResponse(400, {
            error: 'Game full',
            message: 'Game already has 4 players',
          });
        }

        // Check if player name is already taken
        if (isNameTaken(game.players, trimmedPlayerName)) {
          return buildResponse(400, {
            error: 'Name taken',
            message: 'A player with that name is already in the game',
          });
        }

        // Attempt to add the player
        const updatedGame = await addPlayerToGame(game, trimmedPlayerName);

        console.log(`[JOIN_GAME] Player ${trimmedPlayerName} joined game ${normalizedGameId} at seat ${updatedGame.assignedSeat}`);
        console.log(`[JOIN_GAME] Current players:`, JSON.stringify(updatedGame.players));

        // Broadcast playerJoined to all connected players
        try {
          console.log(`[JOIN_GAME] Creating API Gateway client for broadcast...`);
          const apiGatewayClient = createApiGatewayClient(event);
          
          console.log(`[JOIN_GAME] Broadcasting playerJoined for ${trimmedPlayerName}...`);
          const broadcastResult = await broadcastToGame(apiGatewayClient, normalizedGameId, {
            action: 'playerJoined',
            player: {
              seat: updatedGame.assignedSeat,
              name: trimmedPlayerName,
            },
            players: updatedGame.players,
            status: updatedGame.status,
          });
          console.log(`[JOIN_GAME] ✓ Broadcast complete: ${broadcastResult.success}/${broadcastResult.total} connections received playerJoined`);
          
          if (broadcastResult.failed > 0) {
            console.log(`[JOIN_GAME] ⚠️ ${broadcastResult.failed} connections failed to receive message`);
          }
        } catch (broadcastError) {
          // Don't fail the join if broadcast fails
          console.error(`[JOIN_GAME] ✗ Failed to broadcast playerJoined:`, broadcastError.message);
          console.error(`[JOIN_GAME] Stack:`, broadcastError.stack);
        }

        // Return success response
        return buildResponse(200, {
          success: true,
          gameId: updatedGame.gameId,
          seat: updatedGame.assignedSeat,
          players: updatedGame.players,
          status: updatedGame.status,
          hostName: updatedGame.hostName,
        });

      } catch (error) {
        // Handle custom error codes
        if (error.code === 'GAME_FULL') {
          return buildResponse(400, {
            error: 'Game full',
            message: error.message,
          });
        }

        // Handle optimistic locking conflict - retry
        if (error.name === 'ConditionalCheckFailedException') {
          console.log(`Optimistic locking conflict, retrying (attempt ${attempt + 1})`);
          lastError = error;
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
          continue;
        }

        // Re-throw other errors
        throw error;
      }
    }

    // If we exhausted retries, return conflict error
    console.error('Failed to join game after max retries:', lastError);
    return buildResponse(409, {
      error: 'Join conflict',
      message: 'Too many concurrent join attempts, please try again',
    });

  } catch (error) {
    console.error('Error joining game:', error);

    return buildResponse(500, {
      error: 'Internal server error',
      message: 'Failed to join game',
    });
  }
}

module.exports = { handler };
