/**
 * ResetGame Lambda Handler
 *
 * Resets a finished game back to LOBBY status so players can start a new game
 * without leaving the room.
 *
 * HTTP API: POST /resetGame
 * Request body: { "gameId": "ABCDEF" }
 * Response: { "success": true }
 */

const { GetCommand, UpdateCommand, BatchWriteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, HANDS_TABLE } = require('../shared/dynamodb');
const { GameStatus, buildResponse } = require('../shared/gameUtils');

// Use local WebSocket in development, AWS API Gateway in production
const wsModule = process.env.DYNAMODB_ENDPOINT
  ? require('../shared/websocketLocal')
  : require('../shared/websocket');

const { createApiGatewayClient, broadcastToGame } = wsModule;

/**
 * Lambda handler for resetting game to lobby
 * @param {object} event - API Gateway event
 * @returns {Promise<object>} HTTP response
 */
async function handler(event) {
  try {
    // Parse request body
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      return buildResponse(400, {
        error: 'Invalid request body',
        message: 'Request body must be valid JSON',
      });
    }

    const { gameId } = body || {};

    if (!gameId || typeof gameId !== 'string') {
      return buildResponse(400, {
        error: 'Missing required field',
        message: 'gameId is required and must be a string',
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

    // Verify game is finished
    if (game.status !== GameStatus.FINISHED) {
      return buildResponse(400, {
        error: 'Game not finished',
        message: 'Can only reset a finished game',
      });
    }

    // Clear all hands from HANDS_TABLE for this game
    try {
      const handsResult = await docClient.send(new QueryCommand({
        TableName: HANDS_TABLE,
        KeyConditionExpression: 'gameId = :gameId',
        ExpressionAttributeValues: {
          ':gameId': normalizedGameId,
        },
      }));

      if (handsResult.Items && handsResult.Items.length > 0) {
        const deleteRequests = handsResult.Items.map(item => ({
          DeleteRequest: {
            Key: {
              gameId: normalizedGameId,
              seat: item.seat,
            },
          },
        }));

        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [HANDS_TABLE]: deleteRequests,
          },
        }));
      }
    } catch (error) {
      console.warn('Error clearing hands:', error);
      // Continue even if clearing hands fails
    }

    // Reset game state to LOBBY (or FULL since we have 4 players)
    // Keep players array but reset everything else
    await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId: normalizedGameId },
      UpdateExpression: `
        SET #status = :status,
            teams = :teams,
            teamScores = :teamScores,
            dealer = :dealer,
            currentRound = :currentRound,
            currentBid = :currentBid,
            highBid = :highBid,
            highBidder = :highBidder,
            bidWinner = :bidWinner,
            winningBid = :winningBid,
            passed = :passed,
            currentBidder = :currentBidder,
            trump = :trump,
            kitty = :kitty,
            currentTrick = :currentTrick,
            currentPlayer = :currentPlayer,
            ledSuit = :ledSuit,
            pointsCaptured = :pointsCaptured,
            handHistory = :handHistory,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': GameStatus.FULL, // All 4 players are still connected
        ':teams': null,
        ':teamScores': { team0: 0, team1: 0 },
        ':dealer': null,
        ':currentRound': 0,
        ':currentBid': null,
        ':highBid': null,
        ':highBidder': null,
        ':bidWinner': null,
        ':winningBid': null,
        ':passed': [],
        ':currentBidder': null,
        ':trump': null,
        ':kitty': [],
        ':currentTrick': [],
        ':currentPlayer': null,
        ':ledSuit': null,
        ':pointsCaptured': { team0: 0, team1: 0 },
        ':handHistory': [],
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
      },
    }));

    console.log(`Game ${normalizedGameId} reset to FULL status`);

    // Broadcast game reset to all players
    try {
      const apiGatewayClient = createApiGatewayClient({});
      await broadcastToGame(apiGatewayClient, normalizedGameId, {
        action: 'gameReset',
        status: GameStatus.FULL,
        players: game.players,
      });
    } catch (wsError) {
      console.error('Error broadcasting game reset:', wsError);
      // Don't fail the request if WebSocket messaging fails
    }

    return buildResponse(200, {
      success: true,
      gameId: normalizedGameId,
      status: GameStatus.FULL,
      message: 'Game reset to lobby. Host can choose partners to start a new game.',
    });
  } catch (error) {
    console.error('Error resetting game:', error);
    return buildResponse(500, {
      error: 'Internal server error',
      message: 'Failed to reset game',
    });
  }
}

module.exports = { handler };
