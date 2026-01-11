/**
 * AddBot Lambda Handler
 * 
 * Allows the host to add an AI bot player to the game.
 * 
 * HTTP API: POST /addBot
 * Request body: { "gameId": "ABCDEF" }
 * Response: { "success": true, "bot": { seat, name, isBot: true }, "players": [...] }
 */

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, CONNECTIONS_TABLE } = require('../shared/dynamodb');
const { 
  GameStatus,
  MAX_PLAYERS,
  getNextAvailableSeat, 
  buildResponse 
} = require('../shared/gameUtils');
const { getNextBotNumber, generateBotConnectionId } = require('../shared/botUtils');

// Use local WebSocket in development, AWS API Gateway in production
const wsModule = process.env.DYNAMODB_ENDPOINT
  ? require('../shared/websocketLocal')
  : require('../shared/websocket');

const { createApiGatewayClient, broadcastToGame } = wsModule;

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
 * Add a bot player to the game
 * @param {object} game - Current game state
 * @returns {Promise<object>} Updated game state with bot added
 */
async function addBotToGame(game) {
  const nextSeat = getNextAvailableSeat(game.players);
  
  if (nextSeat === null) {
    throw { code: 'GAME_FULL', message: 'Game is already full' };
  }

  const botNumber = getNextBotNumber(game.players);
  const botName = `Bot ${botNumber}`;

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
      ':newPlayer': [{ seat: nextSeat, name: botName, isBot: true }],
      ':newStatus': newStatus,
      ':newVersion': game.version + 1,
      ':currentVersion': game.version,
      ':updatedAt': new Date().toISOString(),
    },
    // Optimistic locking: only update if version matches
    ConditionExpression: 'version = :currentVersion',
    ReturnValues: 'ALL_NEW',
  }));

  // Create a bot connection entry (for consistency, even though bots don't use WebSocket)
  const botConnectionId = generateBotConnectionId(game.gameId, nextSeat);
  try {
    await docClient.send(new UpdateCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        gameId: game.gameId,
        connectionId: botConnectionId,
      },
      UpdateExpression: `
        SET playerName = :playerName,
            seat = :seat,
            isBot = :isBot,
            connectedAt = :connectedAt
      `,
      ExpressionAttributeValues: {
        ':playerName': botName,
        ':seat': nextSeat,
        ':isBot': true,
        ':connectedAt': new Date().toISOString(),
      },
    }));
  } catch (error) {
    // Connection table update is not critical - log and continue
    console.warn(`[ADD_BOT] Failed to create connection entry for bot:`, error);
  }

  return {
    ...result.Attributes,
    botSeat: nextSeat,
    botName,
  };
}

/**
 * Lambda handler for adding a bot
 * @param {object} event - API Gateway event
 * @returns {Promise<object>} HTTP response
 */
async function handler(event) {
  console.log('AddBot event:', JSON.stringify(event));

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
    const { gameId } = body || {};

    if (!gameId || typeof gameId !== 'string') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'gameId is required and must be a string',
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

    // Check if game is in a joinable state
    if (game.status !== GameStatus.LOBBY && game.status !== GameStatus.FULL) {
      return buildResponse(400, {
        error: 'Cannot add bot',
        message: 'Bots can only be added before the game starts',
      });
    }

    // Check if game is full
    if (game.players.length >= MAX_PLAYERS) {
      return buildResponse(400, {
        error: 'Game full',
        message: 'Game already has 4 players',
      });
    }

    // Attempt to add the bot
    const updatedGame = await addBotToGame(game);

    console.log(`[ADD_BOT] Bot ${updatedGame.botName} added to game ${normalizedGameId} at seat ${updatedGame.botSeat}`);
    console.log(`[ADD_BOT] Current players:`, JSON.stringify(updatedGame.players));

    // Broadcast playerJoined to all connected players
    try {
      const apiGatewayClient = createApiGatewayClient(event);
      
      console.log(`[ADD_BOT] Broadcasting playerJoined for ${updatedGame.botName}...`);
      const broadcastResult = await broadcastToGame(apiGatewayClient, normalizedGameId, {
        action: 'playerJoined',
        player: {
          seat: updatedGame.botSeat,
          name: updatedGame.botName,
          isBot: true,
        },
        players: updatedGame.players,
        status: updatedGame.status,
      });
      console.log(`[ADD_BOT] ✓ Broadcast complete: ${broadcastResult.success}/${broadcastResult.total} connections received playerJoined`);
      
      if (broadcastResult.failed > 0) {
        console.log(`[ADD_BOT] ⚠️ ${broadcastResult.failed} connections failed to receive message`);
      }
    } catch (broadcastError) {
      // Don't fail the add if broadcast fails
      console.error(`[ADD_BOT] ✗ Failed to broadcast playerJoined:`, broadcastError.message);
    }

    // Return success response
    return buildResponse(200, {
      success: true,
      gameId: updatedGame.gameId,
      bot: {
        seat: updatedGame.botSeat,
        name: updatedGame.botName,
        isBot: true,
      },
      players: updatedGame.players,
      status: updatedGame.status,
    });

  } catch (error) {
    console.error('Error adding bot:', error);

    // Handle custom error codes
    if (error.code === 'GAME_FULL') {
      return buildResponse(400, {
        error: 'Game full',
        message: error.message,
      });
    }

    // Handle optimistic locking conflict
    if (error.name === 'ConditionalCheckFailedException') {
      return buildResponse(409, {
        error: 'Concurrent update conflict',
        message: 'Game state changed, please try again',
      });
    }

    return buildResponse(500, {
      error: 'Internal server error',
      message: 'Failed to add bot',
    });
  }
}

module.exports = { handler };
