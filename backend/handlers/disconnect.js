/**
 * WebSocket $disconnect Lambda Handler
 * 
 * Handles WebSocket disconnections from players.
 * Removes connection info from the Connections table.
 * 
 * WebSocket API: $disconnect route
 * 
 * Note: $disconnect event only provides connectionId, not the original query params.
 * We use a GSI (ConnectionIdIndex) to look up the connection item by connectionId.
 */

const { QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, CONNECTIONS_TABLE, CONNECTION_ID_INDEX } = require('../shared/dynamodb');

/**
 * Find a connection by connectionId using the GSI
 * @param {string} connectionId - WebSocket connection ID
 * @returns {Promise<object|null>} Connection item or null if not found
 */
async function findConnectionById(connectionId) {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: CONNECTION_ID_INDEX,
      KeyConditionExpression: 'connectionId = :connId',
      ExpressionAttributeValues: {
        ':connId': connectionId,
      },
      Limit: 1,
    }));

    return result.Items?.[0] || null;
  } catch (error) {
    console.error('Error querying connection by ID:', error);
    throw error;
  }
}

/**
 * Delete a connection from the table
 * @param {string} gameId - Game ID
 * @param {string} connectionId - Connection ID
 */
async function deleteConnection(gameId, connectionId) {
  await docClient.send(new DeleteCommand({
    TableName: CONNECTIONS_TABLE,
    Key: {
      gameId,
      connectionId,
    },
  }));
}

/**
 * Lambda handler for WebSocket $disconnect
 * @param {object} event - API Gateway WebSocket event
 * @returns {Promise<object>} WebSocket response
 */
async function handler(event) {
  console.log('WebSocket $disconnect event:', JSON.stringify(event));

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

    // Find the connection using the GSI
    const connection = await findConnectionById(connectionId);

    if (!connection) {
      console.log(`Connection ${connectionId} not found in table (may have already been deleted)`);
      return {
        statusCode: 200,
        body: 'Disconnected (connection not found)',
      };
    }

    // Delete the connection
    await deleteConnection(connection.gameId, connectionId);

    console.log(`Player "${connection.playerName}" disconnected from game ${connection.gameId}`);

    return {
      statusCode: 200,
      body: 'Disconnected',
    };

  } catch (error) {
    console.error('Error handling $disconnect:', error);
    
    // Return success anyway - we don't want to fail the disconnect
    // The connection will be stale but cleanup can happen later
    return {
      statusCode: 200,
      body: 'Disconnected (with errors)',
    };
  }
}

module.exports = { handler };
