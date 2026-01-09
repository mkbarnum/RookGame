/**
 * CreateGame Lambda Handler
 * 
 * Creates a new game lobby and returns the game code to the host.
 * 
 * HTTP API: POST /createGame
 * Request body: { "hostName": "PlayerName" }
 * Response: { "gameId": "ABCDEF", "seat": 0, "game": {...} }
 */

const { PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE } = require('../shared/dynamodb');
const { 
  generateGameCode, 
  createInitialGameState, 
  buildResponse 
} = require('../shared/gameUtils');

/**
 * Maximum attempts to generate a unique game code
 */
const MAX_CODE_ATTEMPTS = 5;

/**
 * Check if a game code already exists
 * @param {string} gameId - Game code to check
 * @returns {Promise<boolean>} True if exists
 */
async function gameExists(gameId) {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
      ProjectionExpression: 'gameId',
    }));
    return !!result.Item;
  } catch (error) {
    console.error('Error checking game existence:', error);
    throw error;
  }
}

/**
 * Generate a unique game code that doesn't exist in the database
 * @returns {Promise<string>} Unique game code
 */
async function generateUniqueGameCode() {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateGameCode();
    const exists = await gameExists(code);
    if (!exists) {
      return code;
    }
    console.log(`Game code ${code} already exists, generating new one (attempt ${attempt + 1})`);
  }
  throw new Error('Failed to generate unique game code after multiple attempts');
}

/**
 * Lambda handler for creating a new game
 * @param {object} event - API Gateway event
 * @returns {Promise<object>} HTTP response
 */
async function handler(event) {
  console.log('CreateGame event:', JSON.stringify(event));

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
    const { hostName } = body || {};
    
    if (!hostName || typeof hostName !== 'string') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'hostName is required and must be a string',
      });
    }

    // Trim and validate host name
    const trimmedHostName = hostName.trim();
    if (trimmedHostName.length < 1 || trimmedHostName.length > 20) {
      return buildResponse(400, {
        error: 'Invalid hostName',
        message: 'hostName must be between 1 and 20 characters',
      });
    }

    // Generate unique game code
    const gameId = await generateUniqueGameCode();

    // Create initial game state
    const gameState = createInitialGameState(gameId, trimmedHostName);

    // Store in DynamoDB
    await docClient.send(new PutCommand({
      TableName: GAMES_TABLE,
      Item: gameState,
      // Ensure we don't overwrite an existing game (extra safety)
      ConditionExpression: 'attribute_not_exists(gameId)',
    }));

    console.log(`Created new game: ${gameId} by ${trimmedHostName}`);

    // Return success response
    return buildResponse(201, {
      success: true,
      gameId: gameState.gameId,
      seat: 0, // Host is always seat 0
      game: {
        gameId: gameState.gameId,
        hostName: gameState.hostName,
        players: gameState.players,
        status: gameState.status,
        createdAt: gameState.createdAt,
      },
    });

  } catch (error) {
    console.error('Error creating game:', error);

    // Handle specific DynamoDB errors
    if (error.name === 'ConditionalCheckFailedException') {
      return buildResponse(409, {
        error: 'Game creation conflict',
        message: 'Please try again',
      });
    }

    return buildResponse(500, {
      error: 'Internal server error',
      message: 'Failed to create game',
    });
  }
}

module.exports = { handler };
