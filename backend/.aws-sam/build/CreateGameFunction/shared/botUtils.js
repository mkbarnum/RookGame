/**
 * Bot utility functions
 * 
 * Works in both local development (setTimeout) and production (Lambda invocation)
 */

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

/**
 * Check if a player is a bot
 * @param {Array} players - Array of player objects
 * @param {number} seat - Seat number to check
 * @returns {boolean} True if player at seat is a bot
 */
function isBot(players, seat) {
  const player = players.find(p => p.seat === seat);
  return player ? (player.isBot === true) : false;
}

/**
 * Get all bot players in a game
 * @param {Array} players - Array of player objects
 * @returns {Array} Array of bot player objects
 */
function getBotPlayers(players) {
  return players.filter(p => p.isBot === true);
}

/**
 * Get next bot number for naming
 * @param {Array} players - Array of player objects
 * @returns {number} Next bot number (1, 2, 3, etc.)
 */
function getNextBotNumber(players) {
  const bots = getBotPlayers(players);
  const botNumbers = bots
    .map(bot => {
      const match = bot.name.match(/^Bot (\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(n => n > 0);
  
  if (botNumbers.length === 0) return 1;
  return Math.max(...botNumbers) + 1;
}

/**
 * Generate bot connection ID
 * @param {string} gameId - Game ID
 * @param {number} seat - Bot seat
 * @returns {string} Bot connection ID
 */
function generateBotConnectionId(gameId, seat) {
  return `bot_${gameId}_${seat}`;
}

// Track scheduled bot actions to prevent duplicates (for local development)
const scheduledActions = new Map(); // key: `${gameId}:${botSeat}`, value: timeout ID

/**
 * Check if we're running in local development mode
 * @returns {boolean} True if local development
 */
function isLocalDevelopment() {
  return !!process.env.DYNAMODB_ENDPOINT;
}

/**
 * Schedule a bot action with delay
 * 
 * In local development: uses setTimeout (server stays running)
 * In production Lambda: invokes Lambda asynchronously with a small delay handled internally
 * 
 * @param {string} gameId - Game ID
 * @param {number} botSeat - Bot seat
 * @param {number} delayMs - Delay in milliseconds (default 1000)
 * @returns {Promise<void>}
 */
async function scheduleBotAction(gameId, botSeat, delayMs = 1000) {
  const actionKey = `${gameId}:${botSeat}`;
  
  console.log(`[BOT_UTILS] Scheduling bot action for game ${gameId}, seat ${botSeat} in ${delayMs}ms`);
  
  if (isLocalDevelopment()) {
    // LOCAL DEVELOPMENT: Use setTimeout (fire and forget - no await needed)
    scheduleLocalBotAction(gameId, botSeat, delayMs, actionKey);
  } else {
    // PRODUCTION: Invoke Lambda asynchronously - MUST await to ensure invocation completes
    await scheduleProductionBotAction(gameId, botSeat, delayMs);
  }
}

/**
 * Schedule bot action for local development using setTimeout
 */
function scheduleLocalBotAction(gameId, botSeat, delayMs, actionKey) {
  // Cancel any existing scheduled action for this game/seat
  if (scheduledActions.has(actionKey)) {
    const existingTimeout = scheduledActions.get(actionKey);
    clearTimeout(existingTimeout);
    console.log(`[BOT_UTILS] Cancelled duplicate bot action for game ${gameId}, seat ${botSeat}`);
  }
  
  const dynamodbEndpoint = process.env.DYNAMODB_ENDPOINT;
  
  const timeoutId = setTimeout(async () => {
    // Remove from scheduled actions map when executed
    scheduledActions.delete(actionKey);
    
    try {
      // Restore environment variable if it was set
      if (dynamodbEndpoint && !process.env.DYNAMODB_ENDPOINT) {
        process.env.DYNAMODB_ENDPOINT = dynamodbEndpoint;
      }
      
      const { handler } = require('../handlers/botAction');
      const result = await handler({
        body: JSON.stringify({ gameId, botSeat }),
      });
      console.log(`[BOT_UTILS] Bot action completed for seat ${botSeat}:`, result?.statusCode || 'unknown');
    } catch (error) {
      console.error(`[BOT_UTILS] Error executing bot action:`, error);
      console.error(`[BOT_UTILS] Stack:`, error.stack);
    }
  }, delayMs);
  
  // Store the timeout ID so we can cancel it if needed
  scheduledActions.set(actionKey, timeoutId);
}

/**
 * Schedule bot action for production using Lambda async invocation
 * 
 * Note: Lambda async invocation doesn't support delays, so we include the delay
 * in the payload and have the bot action handler sleep before executing.
 */
async function scheduleProductionBotAction(gameId, botSeat, delayMs) {
  const functionName = process.env.BOT_ACTION_FUNCTION_NAME;
  
  if (!functionName) {
    console.error('[BOT_UTILS] BOT_ACTION_FUNCTION_NAME not set - cannot schedule bot action in production');
    return;
  }
  
  try {
    const lambdaClient = new LambdaClient({});
    
    const payload = {
      body: JSON.stringify({ 
        gameId, 
        botSeat,
        delayMs, // Include delay so handler can sleep
      }),
    };
    
    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // Async invocation - doesn't wait for response
      Payload: JSON.stringify(payload),
    });
    
    await lambdaClient.send(command);
    console.log(`[BOT_UTILS] Lambda async invocation sent for bot ${botSeat} in game ${gameId}`);
    
  } catch (error) {
    console.error(`[BOT_UTILS] Failed to invoke Lambda for bot action:`, error);
  }
}

module.exports = {
  isBot,
  getBotPlayers,
  getNextBotNumber,
  generateBotConnectionId,
  scheduleBotAction,
};
