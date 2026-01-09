/**
 * StartNextHand Lambda Handler
 *
 * Allows the current dealer to explicitly start the next hand.
 * Deals a new round of cards and transitions the game back into BIDDING.
 */

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, HANDS_TABLE } = require('../shared/dynamodb');
const { GameStatus, BID_MIN, buildResponse } = require('../shared/gameUtils');
const { dealGame } = require('../shared/dealUtils');

// Use local WebSocket in development, AWS API Gateway in production
const wsModule = process.env.DYNAMODB_ENDPOINT
  ? require('../shared/websocketLocal')
  : require('../shared/websocket');

const {
  createApiGatewayClient,
  sendToPlayer,
  broadcastToGame,
  getGameConnections,
} = wsModule;

async function handler(event) {
  try {
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      return buildResponse(400, {
        error: 'Invalid request body',
        message: 'Request body must be valid JSON',
      });
    }

    const { gameId, dealerSeat } = body || {};

    if (!gameId || typeof gameId !== 'string') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'gameId is required and must be a string',
      });
    }

    if (typeof dealerSeat !== 'number') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'dealerSeat is required and must be a number',
      });
    }

    const normalizedGameId = gameId.trim().toUpperCase();

    // Fetch current game state
    const gameResult = await docClient.send(new GetCommand({
      TableName: GAMES_TABLE,
      Key: { gameId: normalizedGameId },
    }));

    const game = gameResult.Item;
    if (!game) {
      return buildResponse(404, {
        error: 'Game not found',
        message: `No game found with code: ${normalizedGameId}`,
      });
    }

    // Verify this player is the current dealer
    const currentDealer = typeof game.dealer === 'number' ? game.dealer : 0;
    if (dealerSeat !== currentDealer) {
      return buildResponse(403, {
        error: 'Not dealer',
        message: `Only the dealer (seat ${currentDealer}) can start the next hand`,
      });
    }

    // Ensure game is not already finished
    const teamScores = game.teamScores || { team0: 0, team1: 0 };
    const gameOver = teamScores.team0 >= 500 || teamScores.team1 >= 500;
    if (gameOver || game.status === GameStatus.FINISHED) {
      return buildResponse(400, {
        error: 'Game over',
        message: 'Game is already finished. Cannot start a new hand.',
      });
    }

    // Deal a new hand – this will:
    // - store new hands in HANDS_TABLE
    // - update game to BIDDING status
    // - set highBid/currentBid/currentBidder/passed/kitty/trumpColor
    const { hands, kitty } = await dealGame(normalizedGameId, game.version);

    // Send WebSocket messages to players (similar to choosePartner)
    try {
      const apiGatewayClient = createApiGatewayClient({});

      // Send private hand messages to each player
      for (let seat = 0; seat < 4; seat++) {
        const handKey = `hand${seat}`;
        const playerCards = hands[handKey];

        await sendToPlayer(apiGatewayClient, normalizedGameId, seat, {
          action: 'deal',
          cards: playerCards,
        });
      }

      // Broadcast bidding start message to all players.
      // For new hands, bidding starts with the player to the left of the dealer.
      const startingPlayer = (currentDealer + 1) % 4;
      await broadcastToGame(apiGatewayClient, normalizedGameId, {
        action: 'biddingStart',
        startingPlayer,
        minBid: BID_MIN,
      });
    } catch (wsError) {
      console.error('Error sending WebSocket messages for next hand:', wsError);
      // Don't fail the HTTP request if WebSocket messaging fails
    }

    // Return success
    return buildResponse(200, {
      success: true,
      gameId: normalizedGameId,
      kittyCount: Array.isArray(kitty) ? kitty.length : 0,
      message: 'Next hand started and cards dealt.',
    });
  } catch (error) {
    console.error('Error starting next hand:', error);
    return buildResponse(500, {
      error: 'Internal server error',
      message: 'Failed to start next hand',
    });
  }
}

module.exports = { handler };

