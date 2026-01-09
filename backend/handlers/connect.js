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

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, CONNECTIONS_TABLE } = require('../shared/dynamodb');

/**
 * Lambda handler for WebSocket $connect
 * @param {object} event - API Gateway WebSocket event
 * @returns {Promise<object>} WebSocket response
 */
async function handler(event) {
  console.log('WebSocket $connect event:', JSON.stringify(event));

  try {
    // Get connection ID from API Gateway
    const connectionId = event.requestContext?.connectionId;
    
    if (!connectionId) {
      console.error('No connectionId in event');
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
      console.error('Missing gameId in query parameters');
      return {
        statusCode: 400,
        body: 'Missing gameId query parameter',
      };
    }

    if (!playerName) {
      console.error('Missing playerName in query parameters');
      return {
        statusCode: 400,
        body: 'Missing playerName query parameter',
      };
    }

    // Seat is optional at connect time but useful if provided
    const seatNumber = seat !== undefined ? parseInt(seat, 10) : null;

    // Store connection in DynamoDB
    const connectionItem = {
      gameId: gameId.toUpperCase(),
      connectionId,
      playerName: decodeURIComponent(playerName),
      seat: seatNumber,
      connectedAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: connectionItem,
    }));

    console.log(`Player "${playerName}" connected to game ${gameId} with connectionId ${connectionId}`);

    return {
      statusCode: 200,
      body: 'Connected',
    };

  } catch (error) {
    console.error('Error handling $connect:', error);
    
    return {
      statusCode: 500,
      body: 'Failed to connect',
    };
  }
}

module.exports = { handler };
