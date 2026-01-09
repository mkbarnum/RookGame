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
  
  // Fallback: create a mock client that logs warnings
  console.warn('Local WebSocket client not available, messages will not be sent');
  return {
    sendToConnection: async () => { console.warn('WebSocket not available'); },
    sendToPlayer: async () => { console.warn('WebSocket not available'); },
    broadcastToGame: async () => { console.warn('WebSocket not available'); },
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
 * @returns {Promise<void>}
 */
async function sendToConnection(client, connectionId, message) {
  await client.sendToConnection(connectionId, message);
}

/**
 * Send a message to all connections in a game
 * @param {object} client - WebSocket client
 * @param {string} gameId - Game ID
 * @param {object} message - Message object to broadcast
 * @returns {Promise<void>}
 */
async function broadcastToGame(client, gameId, message) {
  await client.broadcastToGame(gameId, message);
  
  // If this is a seatsRearranged message, update in-memory connections
  if (message.action === 'seatsRearranged' && message.players) {
    const connections = await client.getGameConnections(gameId);
    const seatMapping = {};
    
    // Create mapping from old seat to new seat
    connections.forEach(conn => {
      if (conn.seat !== null && conn.seat !== undefined) {
        const player = message.players.find(p => {
          // Find player by connection info - we need to match by name or connectionId
          // Since we don't have player name in connection, we'll update based on the broadcast
          return true; // This will be handled by the frontend receiving the message
        });
      }
    });
    
    // Update in-memory connections
    if (client.connections) {
      for (const [connId, connInfo] of client.connections.entries()) {
        if (connInfo.gameId === gameId.toUpperCase() && connInfo.seat !== null && connInfo.seat !== undefined) {
          const newPlayer = message.players.find(p => {
            // Match by player name from connection
            return p.name === connInfo.playerName;
          });
          if (newPlayer) {
            connInfo.seat = newPlayer.seat;
            console.log(`Updated connection ${connId} seat from ${connInfo.seat} to ${newPlayer.seat}`);
          }
        }
      }
    }
  }
}

/**
 * Send a private message to a specific player by seat
 * @param {object} client - WebSocket client
 * @param {string} gameId - Game ID
 * @param {number} seat - Player seat number
 * @param {object} message - Message object to send
 * @returns {Promise<void>}
 */
async function sendToPlayer(client, gameId, seat, message) {
  await client.sendToPlayer(gameId, seat, message);
}

module.exports = {
  createApiGatewayClient,
  getGameConnections,
  sendToConnection,
  broadcastToGame,
  sendToPlayer,
};
