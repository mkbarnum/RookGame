/**
 * WebSocket Router Lambda Handler
 * 
 * Routes WebSocket messages to the appropriate handler based on action type.
 * Handles: playCard, resetGame, startNextHand, and other game actions.
 * 
 * WebSocket API: $default route
 */

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, CONNECTIONS_TABLE } = require('../shared/dynamodb');
const { handler: gameAction } = require('./gameAction');
const { handler: resetGame } = require('./resetGame');
const { handler: startNextHand } = require('./startNextHand');

/**
 * Get connection info from DynamoDB by connectionId
 */
async function getConnectionInfo(connectionId) {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'ConnectionIdIndex',
      KeyConditionExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId,
      },
    }));
    return result.Items?.[0] || null;
  } catch (error) {
    console.error('Error getting connection info:', error);
    return null;
  }
}

/**
 * Convert WebSocket event to HTTP-style event for handlers
 * Handlers expect HTTP events but can work with WebSocket events
 * if we structure the event properly
 */
function websocketToHttpEvent(wsEvent, messageBody) {
  // Get connection info from WebSocket event
  const connectionId = wsEvent.requestContext?.connectionId;
  const domainName = wsEvent.requestContext?.domainName || wsEvent.requestContext?.domain;
  const stage = wsEvent.requestContext?.stage;
  const apiId = wsEvent.requestContext?.apiId;
  
  // For WebSocket API Gateway, construct the management endpoint
  // Format: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
  let managementEndpoint = null;
  if (domainName && stage) {
    // domainName is like: {api-id}.execute-api.{region}.amazonaws.com
    managementEndpoint = `https://${domainName}/${stage}`;
  } else if (apiId) {
    // Fallback: construct from apiId and region
    const region = process.env.AWS_REGION || 'us-east-1';
    managementEndpoint = `https://${apiId}.execute-api.${region}.amazonaws.com/${stage || 'prod'}`;
  }
  
  // Parse query parameters if available (from connection URL)
  const queryParams = wsEvent.queryStringParameters || {};
  
  // Create HTTP-style event that handlers can process
  // Include the message body and preserve WebSocket context
  return {
    body: JSON.stringify(messageBody),
    requestContext: {
      connectionId,
      domainName: domainName || managementEndpoint?.replace('https://', '').split('/')[0],
      stage: stage || 'prod',
      apiId,
      routeKey: wsEvent.requestContext?.routeKey,
      // Preserve original WebSocket context for API Gateway client creation
      requestId: wsEvent.requestContext?.requestId,
    },
    queryStringParameters: queryParams,
    // Store management endpoint for websocket.js to use
    _websocketEndpoint: managementEndpoint,
  };
}

/**
 * Lambda handler for WebSocket $default route
 */
async function handler(event) {
  console.log('WebSocket message received:', JSON.stringify(event, null, 2));
  
  try {
    // Parse message body
    let messageBody;
    try {
      messageBody = typeof event.body === 'string' 
        ? JSON.parse(event.body) 
        : event.body;
    } catch (parseError) {
      console.error('Error parsing WebSocket message:', parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid message format',
          message: 'Message must be valid JSON',
        }),
      };
    }
    
    if (!messageBody || !messageBody.action) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing action',
          message: 'Message must include an action field',
        }),
      };
    }
    
    const { action } = messageBody;
    const connectionId = event.requestContext?.connectionId;
    
    // If gameId is not in message, look it up from the connection
    if (!messageBody.gameId && connectionId) {
      const connectionInfo = await getConnectionInfo(connectionId);
      if (connectionInfo) {
        messageBody.gameId = connectionInfo.gameId;
        messageBody.playerName = connectionInfo.playerName;
        console.log(`Added gameId=${connectionInfo.gameId}, playerName=${connectionInfo.playerName} from connection`);
      } else {
        console.error('Connection not found:', connectionId);
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Connection not found',
            message: 'Your connection was not found. Please reconnect.',
          }),
        };
      }
    }
    
    // Convert WebSocket event to HTTP-style event for handler compatibility
    const httpEvent = websocketToHttpEvent(event, messageBody);
    
    let result;
    
    // Route to appropriate handler based on action
    switch (action) {
      case 'playCard':
      case 'bid':
      case 'pass':
      case 'discardAndTrump':
      case 'choosePartner':
      case 'resync':
      case 'quickChat':
        // These are handled by gameAction
        result = await gameAction(httpEvent);
        break;
        
      case 'resetGame':
        result = await resetGame(httpEvent);
        break;
        
      case 'startNextHand':
        result = await startNextHand(httpEvent);
        break;
        
      default:
        // Try gameAction for unknown actions
        console.log(`Unknown action "${action}", routing to gameAction`);
        result = await gameAction(httpEvent);
    }
    
    // For WebSocket, handlers broadcast messages directly
    // We just need to return a success status
    // The handlers use the websocket module to send messages
    if (result && result.statusCode) {
      // Return the status code, but handlers handle the actual messaging
      return {
        statusCode: result.statusCode === 200 ? 200 : 500,
        body: result.statusCode === 200 
          ? JSON.stringify({ success: true })
          : result.body,
      };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
    
  } catch (error) {
    console.error('Error in WebSocket router:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
      }),
    };
  }
}

module.exports = { handler };
