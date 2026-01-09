/**
 * WebSocket utility functions for sending messages via API Gateway Management API
 * 
 * Used to send messages to connected WebSocket clients.
 */

const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, CONNECTIONS_TABLE } = require('./dynamodb');

// Create API Gateway Management API client
// The endpoint URL is typically: wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
// For local development, we might need to handle this differently
function createApiGatewayClient(event) {
  const endpoint = event?.requestContext?.domainName 
    ? `https://${event.requestContext.domainName}/${event.requestContext.stage}`
    : process.env.WS_API_ENDPOINT || 'http://localhost:3001';
  
  return new ApiGatewayManagementApiClient({
    endpoint,
    region: process.env.AWS_REGION || 'us-east-1',
  });
}

/**
 * Get all connections for a game
 * @param {string} gameId - Game ID
 * @returns {Promise<Array>} Array of connection items
 */
async function getGameConnections(gameId) {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      KeyConditionExpression: 'gameId = :gameId',
      ExpressionAttributeValues: {
        ':gameId': gameId,
      },
    }));

    return result.Items || [];
  } catch (error) {
    console.error('Error querying connections:', error);
    throw error;
  }
}

/**
 * Send a message to a specific WebSocket connection
 * @param {object} apiGatewayClient - API Gateway Management API client
 * @param {string} connectionId - Connection ID
 * @param {object} message - Message object to send
 * @returns {Promise<void>}
 */
async function sendToConnection(apiGatewayClient, connectionId, message) {
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message),
    });

    await apiGatewayClient.send(command);
    console.log(`Sent message to connection ${connectionId}:`, message);
  } catch (error) {
    // Connection might be stale - log but don't throw
    if (error.name === 'GoneException' || error.statusCode === 410) {
      console.log(`Connection ${connectionId} is gone (disconnected)`);
    } else {
      console.error(`Error sending message to connection ${connectionId}:`, error);
      throw error;
    }
  }
}

/**
 * Send a message to all connections in a game
 * @param {object} apiGatewayClient - API Gateway Management API client
 * @param {string} gameId - Game ID
 * @param {object} message - Message object to broadcast
 * @returns {Promise<void>}
 */
async function broadcastToGame(apiGatewayClient, gameId, message) {
  const connections = await getGameConnections(gameId);
  
  console.log(`Broadcasting to ${connections.length} connections in game ${gameId}`);
  
  // Send to all connections in parallel
  await Promise.allSettled(
    connections.map(conn => 
      sendToConnection(apiGatewayClient, conn.connectionId, message)
    )
  );
}

/**
 * Send a private message to a specific player by seat
 * @param {object} apiGatewayClient - API Gateway Management API client
 * @param {string} gameId - Game ID
 * @param {number} seat - Player seat number
 * @param {object} message - Message object to send
 * @returns {Promise<void>}
 */
async function sendToPlayer(apiGatewayClient, gameId, seat, message) {
  const connections = await getGameConnections(gameId);
  const playerConnection = connections.find(conn => conn.seat === seat);
  
  if (playerConnection) {
    await sendToConnection(apiGatewayClient, playerConnection.connectionId, message);
  } else {
    console.warn(`No connection found for seat ${seat} in game ${gameId}`);
  }
}

module.exports = {
  createApiGatewayClient,
  getGameConnections,
  sendToConnection,
  broadcastToGame,
  sendToPlayer,
};
