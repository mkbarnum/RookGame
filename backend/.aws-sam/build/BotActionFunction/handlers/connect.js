/**
 * WebSocket $connect Lambda Handler
 * 
 * Handles new WebSocket connections from players.
 * Stores connection info in the Connections table for message broadcasting.
 * 
 * WebSocket API: $connect route
 * Query params: gameId, playerName, seat
 * 
 * Example connection URL:
 * wss://API_URL/prod?gameId=ABC123&playerName=Alice&seat=0
 */

const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, CONNECTIONS_TABLE } = require('../shared/dynamodb');

// Debug logging helper
function debugLog(category, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    category,
    message,
    ...(data && { data }),
  };
  console.log(`[CONNECT-DEBUG] ${JSON.stringify(logEntry)}`);
}

/**
 * Lambda handler for WebSocket $connect
 * @param {object} event - API Gateway WebSocket event
 * @returns {Promise<object>} WebSocket response
 */
async function handler(event) {
  debugLog('CONNECT', 'New connection attempt', {
    connectionId: event.requestContext?.connectionId?.slice(-8),
    queryParams: event.queryStringParameters,
    sourceIp: event.requestContext?.identity?.sourceIp,
    userAgent: event.requestContext?.identity?.userAgent?.slice(0, 50),
  });

  try {
    // Get connection ID from API Gateway
    const connectionId = event.requestContext?.connectionId;
    
    if (!connectionId) {
      debugLog('ERROR', 'No connectionId in event');
      return {
        statusCode: 400,
        body: 'Missing connectionId',
      };
    }

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const { gameId, playerName, seat } = queryParams;

    // Validate required parameters
    if (!gameId) {
      debugLog('ERROR', 'Missing gameId in query parameters');
      return {
        statusCode: 400,
        body: 'Missing gameId query parameter',
      };
    }

    if (!playerName) {
      debugLog('ERROR', 'Missing playerName in query parameters');
      return {
        statusCode: 400,
        body: 'Missing playerName query parameter',
      };
    }

    // Seat is optional at connect time but useful if provided
    const seatNumber = seat !== undefined ? parseInt(seat, 10) : null;
    const normalizedGameId = gameId.toUpperCase();
    const decodedPlayerName = decodeURIComponent(playerName);

    // Check existing connections for this game
    const existingConnections = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      KeyConditionExpression: 'gameId = :gameId',
      ExpressionAttributeValues: {
        ':gameId': normalizedGameId,
      },
    }));
    
    debugLog('CONNECT', 'Existing connections before adding new one', {
      gameId: normalizedGameId,
      count: existingConnections.Items?.length || 0,
      connections: (existingConnections.Items || []).map(c => ({
        playerName: c.playerName,
        seat: c.seat,
        connectionId: c.connectionId?.slice(-8),
      })),
    });

    // Store connection in DynamoDB
    const connectionItem = {
      gameId: normalizedGameId,
      connectionId,
      playerName: decodedPlayerName,
      seat: seatNumber,
      connectedAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: connectionItem,
    }));

    debugLog('CONNECT', '✓ Connection stored successfully', {
      gameId: normalizedGameId,
      playerName: decodedPlayerName,
      seat: seatNumber,
      connectionId: connectionId.slice(-8),
    });

    return {
      statusCode: 200,
      body: 'Connected',
    };

  } catch (error) {
    debugLog('ERROR', 'Failed to handle $connect', {
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3),
    });
    
    return {
      statusCode: 500,
      body: 'Failed to connect',
    };
  }
}

module.exports = { handler };
