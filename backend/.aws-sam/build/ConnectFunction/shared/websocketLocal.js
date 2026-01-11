/**
 * Local WebSocket client for development
 * 
 * Provides the same interface as the AWS API Gateway Management API
 * but uses the local WebSocket server instead.
 */

/**
 * Create a local WebSocket client (uses the global instance from server.js)
 * @param {object} event - Lambda event (not used in local, but kept for compatibility)
 * @returns {object} WebSocket client
 */
function createApiGatewayClient(event) {
  // Return the global local WebSocket client
  if (global.localWebSocketClient) {
    return global.localWebSocketClient;
  }
  
  // Fallback: create a mock client that logs warnings and returns proper format
  console.warn('Local WebSocket client not available, messages will not be sent');
  return {
    sendToConnection: async () => {
      console.warn('WebSocket not available');
      return false;
    },
    sendToPlayer: async () => {
      console.warn('WebSocket not available');
      return false;
    },
    broadcastToGame: async () => {
      console.warn('WebSocket not available');
      return [];
    },
    getGameConnections: async () => {
      console.warn('WebSocket not available');
      return [];
    },
  };
}

/**
 * Get all connections for a game
 * @param {string} gameId - Game ID
 * @returns {Promise<Array>} Array of connection items
 */
async function getGameConnections(gameId) {
  const client = global.localWebSocketClient;
  if (client) {
    return await client.getGameConnections(gameId);
  }
  return [];
}

/**
 * Send a message to a specific WebSocket connection
 * @param {object} client - WebSocket client
 * @param {string} connectionId - Connection ID
 * @param {object} message - Message object to send
 * @param {string} gameId - Game ID (for consistency with production, but not used in local)
 * @returns {Promise<{success: boolean, connectionId: string, error?: string}>}
 */
async function sendToConnection(client, connectionId, message, gameId = null) {
  const result = await client.sendToConnection(connectionId, message);
  
  // Transform result to match production format
  if (result === true) {
    return { success: true, connectionId };
  } else {
    return { success: false, connectionId, error: 'connection_failed' };
  }
}

/**
 * Send a message to all connections in a game
 * @param {object} client - WebSocket client
 * @param {string} gameId - Game ID
 * @param {object} message - Message object to broadcast
 * @returns {Promise<{total: number, success: number, failed: number, details: Array}>}
 */
async function broadcastToGame(client, gameId, message) {
  // Get connections before broadcasting to get accurate count
  const connections = await client.getGameConnections(gameId);
  const total = connections.length;
  
  // Call the client's broadcastToGame method
  const results = await client.broadcastToGame(gameId, message);
  
  // Transform results to match production format
  // results is an array of Promise.allSettled results
  const details = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      // sendToConnection returns true/false, transform to {success, connectionId}
      const success = result.value === true;
      return {
        success,
        connectionId: connections[index]?.connectionId,
        ...(success ? {} : { error: 'connection_failed' }),
      };
    } else {
      // Promise was rejected
      return {
        success: false,
        connectionId: connections[index]?.connectionId,
        error: result.reason?.message || 'unknown_error',
      };
    }
  });
  
  const success = details.filter(r => r.success).length;
  const failed = details.filter(r => !r.success).length;
  
  // If this is a seatsRearranged message, update in-memory connections
  if (message.action === 'seatsRearranged' && message.players) {
    // Update in-memory connections with new seat assignments
    if (client.connections) {
      for (const [connId, connInfo] of client.connections.entries()) {
        if (connInfo.gameId === gameId.toUpperCase() && connInfo.seat !== null && connInfo.seat !== undefined) {
          const newPlayer = message.players.find(p => {
            // Match by player name from connection
            return p.name === connInfo.playerName;
          });
          if (newPlayer && newPlayer.seat !== connInfo.seat) {
            const oldSeat = connInfo.seat;
            connInfo.seat = newPlayer.seat;
            console.log(`Updated in-memory connection ${connId} (${connInfo.playerName}) seat from ${oldSeat} to ${newPlayer.seat}`);
          }
        }
      }
    }
  }
  
  return {
    total,
    success,
    failed,
    details,
  };
}

/**
 * Send a private message to a specific player by seat
 * @param {object} client - WebSocket client
 * @param {string} gameId - Game ID
 * @param {number} seat - Player seat number
 * @param {object} message - Message object to send
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendToPlayer(client, gameId, seat, message) {
  const result = await client.sendToPlayer(gameId, seat, message);
  
  // Transform result to match production format
  // sendToPlayer returns true/false or the result of sendToConnection
  if (result === true || (result && result.success === true)) {
    return { success: true };
  } else if (result === false || result === undefined) {
    return { success: false, error: 'no_connection' };
  } else if (result && typeof result === 'object') {
    // Already in correct format from sendToConnection wrapper
    return result;
  } else {
    return { success: false, error: 'unknown_error' };
  }
}

module.exports = {
  createApiGatewayClient,
  getGameConnections,
  sendToConnection,
  broadcastToGame,
  sendToPlayer,
};
