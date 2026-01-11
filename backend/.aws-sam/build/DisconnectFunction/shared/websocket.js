/**
 * WebSocket utility functions for sending messages via API Gateway Management API
 * 
 * Used to send messages to connected WebSocket clients.
 */

const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, CONNECTIONS_TABLE } = require('./dynamodb');

// Debug logging helper
function debugLog(category, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    category,
    message,
    ...(data && { data }),
  };
  console.log(`[WS-DEBUG] ${JSON.stringify(logEntry)}`);
}

// Create API Gateway Management API client
// The endpoint URL is typically: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
// For HTTP API events, we use the WS_API_ENDPOINT environment variable
function createApiGatewayClient(event) {
  let endpoint;
  let source = 'unknown';
  
  // Check if endpoint was pre-computed (from WebSocket router)
  if (event?._websocketEndpoint) {
    endpoint = event._websocketEndpoint;
    source = 'pre-computed';
  } else if (event?.requestContext?.eventType === 'CONNECT' || 
             event?.requestContext?.eventType === 'DISCONNECT' ||
             event?.requestContext?.eventType === 'MESSAGE') {
    // This is a WebSocket API event - construct from its context
    const domainName = event.requestContext.domainName;
    const stage = event.requestContext.stage || 'prod';
    endpoint = `https://${domainName}/${stage}`;
    source = 'websocket-event';
  } else if (process.env.WS_API_ENDPOINT) {
    // For HTTP API events, use the WebSocket endpoint from environment variable
    endpoint = process.env.WS_API_ENDPOINT;
    source = 'env-variable';
  } else {
    // Local development fallback
    endpoint = 'http://localhost:3001';
    source = 'local-fallback';
  }
  
  debugLog('CLIENT', `Created API Gateway client`, { endpoint, source });
  
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
    debugLog('QUERY', `Fetching connections for game`, { gameId });
    
    const result = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      KeyConditionExpression: 'gameId = :gameId',
      ExpressionAttributeValues: {
        ':gameId': gameId,
      },
    }));

    const connections = result.Items || [];
    
    // Log detailed connection info
    debugLog('QUERY', `Found ${connections.length} connections`, {
      gameId,
      connections: connections.map(c => ({
        connectionId: c.connectionId?.slice(-8), // Last 8 chars for brevity
        playerName: c.playerName,
        seat: c.seat,
        connectedAt: c.connectedAt,
      })),
    });

    return connections;
  } catch (error) {
    debugLog('ERROR', `Failed to query connections`, { gameId, error: error.message });
    throw error;
  }
}

/**
 * Remove a stale connection from the database
 * @param {string} gameId - Game ID
 * @param {string} connectionId - Connection ID to remove
 */
async function removeStaleConnection(gameId, connectionId) {
  try {
    await docClient.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { gameId, connectionId },
    }));
    debugLog('CLEANUP', `Removed stale connection`, { gameId, connectionId: connectionId.slice(-8) });
  } catch (error) {
    debugLog('ERROR', `Failed to remove stale connection`, { gameId, connectionId: connectionId.slice(-8), error: error.message });
  }
}

/**
 * Send a message to a specific WebSocket connection
 * @param {object} apiGatewayClient - API Gateway Management API client
 * @param {string} connectionId - Connection ID
 * @param {object} message - Message object to send
 * @param {string} gameId - Game ID (for stale connection cleanup)
 * @returns {Promise<{success: boolean, connectionId: string, error?: string}>}
 */
async function sendToConnection(apiGatewayClient, connectionId, message, gameId = null) {
  const connIdShort = connectionId.slice(-8);
  
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message),
    });

    await apiGatewayClient.send(command);
    debugLog('SEND', `✓ Message sent`, { 
      connectionId: connIdShort, 
      action: message.action || 'unknown',
    });
    return { success: true, connectionId };
  } catch (error) {
    // Connection might be stale - log and optionally clean up
    if (error.name === 'GoneException' || error.$metadata?.httpStatusCode === 410) {
      debugLog('SEND', `✗ Connection gone (410)`, { connectionId: connIdShort });
      // Clean up stale connection if we have gameId
      if (gameId) {
        await removeStaleConnection(gameId, connectionId);
      }
      return { success: false, connectionId, error: 'gone' };
    } else {
      debugLog('ERROR', `✗ Send failed`, { 
        connectionId: connIdShort, 
        error: error.message,
        errorName: error.name,
        httpStatus: error.$metadata?.httpStatusCode,
      });
      return { success: false, connectionId, error: error.message };
    }
  }
}

/**
 * Send a message to all connections in a game
 * @param {object} apiGatewayClient - API Gateway Management API client
 * @param {string} gameId - Game ID
 * @param {object} message - Message object to broadcast
 * @param {Array} cachedConnections - Optional: pre-fetched connections array to avoid DB query
 * @returns {Promise<{total: number, success: number, failed: number, details: Array}>}
 */
async function broadcastToGame(apiGatewayClient, gameId, message, cachedConnections = null) {
  debugLog('BROADCAST', `Starting broadcast`, { 
    gameId, 
    action: message.action || 'unknown',
    usingCache: cachedConnections !== null,
  });
  
  const connections = cachedConnections || await getGameConnections(gameId);
  
  if (connections.length === 0) {
    debugLog('BROADCAST', `⚠️ No connections found for game`, { gameId });
    return { total: 0, success: 0, failed: 0, details: [] };
  }
  
  debugLog('BROADCAST', `Sending to ${connections.length} connections`, {
    gameId,
    action: message.action,
    recipients: connections.map(c => ({ name: c.playerName, seat: c.seat })),
  });
  
  // Send to all connections in parallel
  const results = await Promise.all(
    connections.map(conn => 
      sendToConnection(apiGatewayClient, conn.connectionId, message, gameId)
    )
  );
  
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  
  debugLog('BROADCAST', `Broadcast complete`, {
    gameId,
    action: message.action,
    total: connections.length,
    success: successCount,
    failed: failedCount,
  });
  
  if (failedCount > 0) {
    debugLog('BROADCAST', `⚠️ Some messages failed`, {
      gameId,
      failures: results.filter(r => !r.success).map(r => ({
        connectionId: r.connectionId.slice(-8),
        error: r.error,
      })),
    });
  }
  
  return {
    total: connections.length,
    success: successCount,
    failed: failedCount,
    details: results,
  };
}

/**
 * Send a private message to a specific player by seat
 * @param {object} apiGatewayClient - API Gateway Management API client
 * @param {string} gameId - Game ID
 * @param {number} seat - Player seat number
 * @param {object} message - Message object to send
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendToPlayer(apiGatewayClient, gameId, seat, message) {
  debugLog('SEND_TO_PLAYER', `Looking for player`, { gameId, seat, action: message.action });
  
  const connections = await getGameConnections(gameId);
  const playerConnection = connections.find(conn => conn.seat === seat);
  
  if (playerConnection) {
    debugLog('SEND_TO_PLAYER', `Found player connection`, { 
      gameId, 
      seat, 
      playerName: playerConnection.playerName,
      connectionId: playerConnection.connectionId.slice(-8),
    });
    const result = await sendToConnection(apiGatewayClient, playerConnection.connectionId, message, gameId);
    return result;
  } else {
    debugLog('SEND_TO_PLAYER', `⚠️ No connection found for seat`, { 
      gameId, 
      seat,
      availableSeats: connections.map(c => ({ seat: c.seat, name: c.playerName })),
    });
    return { success: false, error: 'no_connection' };
  }
}

module.exports = {
  createApiGatewayClient,
  getGameConnections,
  sendToConnection,
  broadcastToGame,
  sendToPlayer,
};
