/**
 * BotAction Lambda Handler
 * 
 * Handles bot player actions (bidding, playing cards, trump selection, discarding, starting next hand).
 * Called automatically when it's a bot's turn.
 * 
 * Invoked via: { "gameId": "ABCDEF", "botSeat": 1, "delayMs": 1000 }
 * 
 * Works in both local development (direct call) and production (Lambda async invocation).
 */

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, HANDS_TABLE } = require('../shared/dynamodb');
const { GameStatus } = require('../shared/gameUtils');
const { isBot } = require('../shared/botUtils');
const { decideBid, chooseTrump, chooseDiscard, chooseCardToPlay } = require('../shared/botAI');

// Import game action handlers to reuse their logic
const gameActionModule = require('./gameAction');
const startNextHandModule = require('./startNextHand');

/**
 * Sleep for a given number of milliseconds
 * Used in production to add delay before bot action
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch game from DynamoDB
 * @param {string} gameId - Game code
 * @returns {Promise<object|null>} Game object or null if not found
 */
async function getGame(gameId) {
  const result = await docClient.send(new GetCommand({
    TableName: GAMES_TABLE,
    Key: { gameId },
  }));
  return result.Item || null;
}

/**
 * Get bot's hand
 * @param {string} gameId - Game ID
 * @param {number} seat - Bot seat
 * @returns {Promise<Array<string>>} Bot's hand
 */
async function getBotHand(gameId, seat) {
  const result = await docClient.send(new GetCommand({
    TableName: HANDS_TABLE,
    Key: { gameId, seat },
  }));
  return result.Item?.cards || [];
}

/**
 * Lambda handler for bot actions
 * @param {object} event - Event with gameId and botSeat
 * @returns {Promise<object>} Response
 */
async function handler(event) {
  console.log('[BOT_ACTION] Event:', JSON.stringify(event));

  try {
    // Parse request body
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      console.error('[BOT_ACTION] Invalid body:', parseError);
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
    }

    const { gameId, botSeat, delayMs } = body || {};

    if (!gameId || typeof botSeat !== 'number') {
      console.error('[BOT_ACTION] Missing gameId or botSeat');
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing gameId or botSeat' }) };
    }

    // In production, handle delay before executing (Lambda async doesn't support delays)
    if (delayMs && delayMs > 0 && !process.env.DYNAMODB_ENDPOINT) {
      console.log(`[BOT_ACTION] Sleeping for ${delayMs}ms before executing bot action`);
      await sleep(delayMs);
    }

    const normalizedGameId = gameId.trim().toUpperCase();

    // Fetch game state
    const game = await getGame(normalizedGameId);
    if (!game) {
      console.error(`[BOT_ACTION] Game ${normalizedGameId} not found`);
      return { statusCode: 404, body: JSON.stringify({ error: 'Game not found' }) };
    }

    // Verify this is actually a bot
    if (!isBot(game.players, botSeat)) {
      console.error(`[BOT_ACTION] Seat ${botSeat} is not a bot`);
      return { statusCode: 400, body: JSON.stringify({ error: 'Not a bot seat' }) };
    }

    // Get bot's hand
    const hand = await getBotHand(normalizedGameId, botSeat);

    // Determine action based on game status
    let actionResult;

    if (game.status === GameStatus.BIDDING) {
      // Bot's turn to bid
      if (game.currentBidder !== botSeat) {
        console.log(`[BOT_ACTION] Bot ${botSeat} is not the current bidder (current: ${game.currentBidder})`);
        return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Not bot turn' }) };
      }

      // Pass additional context for smarter bidding decisions
      const bidDecision = decideBid(
        hand, 
        game.highBid || 0, 
        game.passed || [],
        botSeat,           // Bot's seat for partner awareness
        game.highBidder,   // Current high bidder seat
        game.teams         // Teams configuration
      );
      console.log(`[BOT_ACTION] Bot ${botSeat} bidding decision:`, bidDecision);

      // Create a mock event for gameAction handler
      // Note: We don't include connectionId because bot connection IDs use original seat numbers
      // which don't match after seat rearrangement. playerName lookup is more reliable.
      const botPlayerName = game.players.find(p => p.seat === botSeat)?.name || `Bot ${botSeat}`;
      console.log(`[BOT_ACTION] Bot at seat ${botSeat} is "${botPlayerName}"`);
      
      const mockEvent = {
        body: JSON.stringify({
          gameId: normalizedGameId,
          playerName: botPlayerName,
          action: bidDecision.action,
          ...(bidDecision.action === 'bid' ? { amount: bidDecision.amount } : {}),
        }),
        // Don't include connectionId - let gameAction use playerName lookup
        requestContext: {},
      };

      if (bidDecision.action === 'bid') {
        actionResult = await gameActionModule.handler(mockEvent);
      } else {
        actionResult = await gameActionModule.handler(mockEvent);
      }

    } else if (game.status === GameStatus.TRUMP_SELECTION) {
      // Bot won the bid - select trump and discard
      if (game.bidWinner !== botSeat) {
        console.log(`[BOT_ACTION] Bot ${botSeat} is not the bid winner (winner: ${game.bidWinner})`);
        return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Not bid winner' }) };
      }

      // Bot should have 18 cards (13 + 5 kitty)
      if (hand.length !== 18) {
        console.log(`[BOT_ACTION] Bot ${botSeat} doesn't have kitty yet (hand size: ${hand.length})`);
        return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Waiting for kitty' }) };
      }

      const trump = chooseTrump(hand);
      const discard = chooseDiscard(hand, trump);
      const botPlayerName = game.players.find(p => p.seat === botSeat)?.name || `Bot ${botSeat}`;
      console.log(`[BOT_ACTION] Bot ${botSeat} (${botPlayerName}) choosing trump: ${trump}, discarding:`, discard);

      const mockEvent = {
        body: JSON.stringify({
          gameId: normalizedGameId,
          playerName: botPlayerName,
          action: 'discardAndTrump',
          discard,
          trump,
        }),
        // Don't include connectionId - let gameAction use playerName lookup
        requestContext: {},
      };

      actionResult = await gameActionModule.handler(mockEvent);

    } else if (game.status === GameStatus.PLAYING) {
      // Check if this bot is the dealer and needs to start the next hand
      // This happens when the hand is complete (bot's hand is empty) and bot is the current dealer
      const currentDealer = typeof game.dealer === 'number' ? game.dealer : 0;
      
      if (hand.length === 0 && botSeat === currentDealer) {
        // Bot is the dealer and hands are empty - need to start next hand
        console.log(`[BOT_ACTION] Bot ${botSeat} is dealer with empty hand - starting next hand`);
        
        const mockEvent = {
          body: JSON.stringify({
            gameId: normalizedGameId,
            dealerSeat: botSeat,
          }),
        };
        
        actionResult = await startNextHandModule.handler(mockEvent);
        
      } else if (game.currentPlayer !== botSeat) {
        console.log(`[BOT_ACTION] Bot ${botSeat} is not the current player (current: ${game.currentPlayer})`);
        return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Not bot turn' }) };
        
      } else {
        // Normal card play
        // Build game context for smarter play decisions
        const gameContext = {
          bidWinner: game.bidWinner,           // Who won the bid (for offensive/defensive play)
          bidAmount: game.highBid,             // The winning bid amount
          myTeamBid: game.teams && game.bidWinner !== undefined 
            ? (game.teams.team0?.includes(game.bidWinner) ? 'team0' : 'team1')
            : null,
          tricksPlayed: game.tricksPlayed || 0,
          pointsCaptured: game.pointsCaptured, // { team0: X, team1: Y }
          cardsPlayed: game.cardsPlayed || [], // All cards played in the current hand
        };

        const card = chooseCardToPlay(
          hand,
          game.trump,
          game.currentTrick || [],
          game.ledSuit || null,
          game.teams,
          botSeat,
          gameContext
        );
        const botPlayerName = game.players.find(p => p.seat === botSeat)?.name || `Bot ${botSeat}`;
        console.log(`[BOT_ACTION] Bot ${botSeat} (${botPlayerName}) playing card: ${card}`);

        const mockEvent = {
          body: JSON.stringify({
            gameId: normalizedGameId,
            playerName: botPlayerName,
            action: 'playCard',
            card,
          }),
          // Don't include connectionId - let gameAction use playerName lookup
          requestContext: {},
        };

        actionResult = await gameActionModule.handler(mockEvent);
      }

    } else {
      console.log(`[BOT_ACTION] Bot ${botSeat} - no action needed in status: ${game.status}`);
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'No action needed' }) };
    }

    console.log(`[BOT_ACTION] Bot ${botSeat} action completed:`, actionResult?.statusCode || 'unknown');
    return actionResult || { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('[BOT_ACTION] Error:', error);
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
