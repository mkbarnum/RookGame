/**
 * GameAction Lambda Handler
 *
 * Handles in-game actions like playing cards.
 *
 * HTTP API: POST /gameAction
 * Request body: { "gameId": "ABCDEF", "playerName": "PlayerName", "action": "playCard", "card": "Green14" }
 * Response: { "success": true }
 */

const { GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, HANDS_TABLE, CONNECTIONS_TABLE } = require('../shared/dynamodb');
const { GameStatus, buildResponse } = require('../shared/gameUtils');

/**
 * Lambda handler for game actions
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

    // Validate required fields
    const { gameId, playerName, action } = body || {};

    if (!gameId || !playerName || !action) {
      return buildResponse(400, {
        error: 'Missing required fields',
        message: 'gameId, playerName, and action are required',
      });
    }

    // Get player connection to determine seat
    const connectionsResult = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      KeyConditionExpression: 'gameId = :gameId',
      FilterExpression: 'playerName = :playerName',
      ExpressionAttributeValues: {
        ':gameId': gameId.toUpperCase(),
        ':playerName': playerName,
      },
    }));

    if (!connectionsResult.Items || connectionsResult.Items.length === 0) {
      return buildResponse(404, {
        error: 'Player not found',
        message: 'Player connection not found in game',
      });
    }

    const playerSeat = connectionsResult.Items[0].seat;
    const connectionId = connectionsResult.Items[0].connectionId;

    // Get current game state
    const gameResult = await docClient.send(new GetCommand({
      TableName: GAMES_TABLE,
      Key: { gameId: gameId.toUpperCase() },
    }));

    const game = gameResult.Item;
    if (!game) {
      return buildResponse(404, {
        error: 'Game not found',
        message: 'The specified game does not exist',
      });
    }

    // Handle different actions
    switch (action) {
      case 'playCard':
        return await handlePlayCard(game, playerSeat, body.card, connectionId);
      default:
        return buildResponse(400, {
          error: 'Unknown action',
          message: `Action '${action}' is not supported`,
        });
    }

  } catch (error) {
    console.error('Error in gameAction handler:', error);
    return buildResponse(500, {
      error: 'Internal server error',
      message: 'Failed to process game action',
    });
  }
}

/**
 * Handle playing a card
 */
async function handlePlayCard(game, playerSeat, card, connectionId) {
  const gameId = game.gameId;

  // Verify game is in PLAYING status
  if (game.status !== GameStatus.PLAYING) {
    return buildResponse(400, {
      error: 'Invalid game state',
      message: 'Game is not in playing state',
    });
  }

  // Verify it's this player's turn
  if (game.currentPlayer !== playerSeat) {
    return buildResponse(400, {
      error: 'Not your turn',
      message: 'It is not your turn to play',
    });
  }

  // Get player's current hand
  const handResult = await docClient.send(new GetCommand({
    TableName: HANDS_TABLE,
    Key: {
      gameId,
      seat: playerSeat,
    },
  }));

  const hand = handResult.Item;
  if (!hand || !hand.cards || !Array.isArray(hand.cards)) {
    return buildResponse(500, {
      error: 'Hand not found',
      message: 'Player hand could not be retrieved',
    });
  }

  // Validate the card is in the player's hand
  if (!hand.cards.includes(card)) {
    return buildResponse(400, {
      error: 'Invalid card',
      message: 'You do not have that card in your hand',
    });
  }

  // Get current trick information
  const currentTrick = game.currentTrick || [];
  const ledSuit = game.ledSuit;

  // Validate card follows suit rules
  if (currentTrick.length > 0 && ledSuit) {
    const cardSuit = getCardSuit(card);
    const trumpSuit = game.trump;

    // Check if player has any cards of the led suit
    const hasLedSuit = hand.cards.some(c => getCardSuit(c) === ledSuit);

    // If player has led suit cards, they must play one
    if (hasLedSuit) {
      // Card must be led suit, OR Rook if led suit is trump (because Rook is trump)
      if (cardSuit !== ledSuit && !(cardSuit === 'Rook' && ledSuit === trumpSuit)) {
        return buildResponse(400, {
          error: 'Must follow suit',
          message: `You must play a card of the led suit (${ledSuit})`,
        });
      }
    }
    // If player doesn't have led suit cards, they can play anything (including Rook)
  }

  // Card is valid - remove it from player's hand
  const updatedHandCards = hand.cards.filter(c => c !== card);
  await docClient.send(new UpdateCommand({
    TableName: HANDS_TABLE,
    Key: {
      gameId,
      seat: playerSeat,
    },
    UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':cards': updatedHandCards,
      ':updatedAt': new Date().toISOString(),
    },
  }));

  // Update game state with the played card
  const updatedCurrentTrick = [...currentTrick, { seat: playerSeat, card }];
  
  // If this is the first card of the trick, set the led suit
  let currentLedSuit = ledSuit; // Use existing ledSuit if not first card
  if (currentTrick.length === 0) {
    const cardSuit = getCardSuit(card);
    currentLedSuit = cardSuit === 'Rook' ? game.trump : cardSuit;
  }

  // Determine if this completes the trick (4 cards played)
  let nextPlayer = (playerSeat + 1) % 4;
  let trickComplete = false;

  // Build update expression based on whether trick is complete
  let updateExpression = `
    SET version = version + :one,
        updatedAt = :updatedAt
  `;
  let expressionAttributeValues = {
    ':one': 1,
    ':updatedAt': new Date().toISOString(),
    ':currentVersion': game.version,
  };

  if (updatedCurrentTrick.length === 4) {
    // Trick is complete - determine winner
    const trickWinner = determineTrickWinner(updatedCurrentTrick, game.trump, currentLedSuit);
    const trickPoints = calculateTrickPoints(updatedCurrentTrick);

    // Update team scores
    const winnerTeam = game.teams.team0.includes(trickWinner) ? 'team0' : 'team1';
    const currentPointsCaptured = game.pointsCaptured || { team0: 0, team1: 0 };

    // When trick is complete, set currentTrick to empty, clear ledSuit, and update points
    updateExpression += `,
      currentTrick = :emptyTrick,
      ledSuit = :nullLedSuit,
      currentPlayer = :nextPlayer,
      pointsCaptured.team0 = :team0Points,
      pointsCaptured.team1 = :team1Points
    `;

    expressionAttributeValues[':emptyTrick'] = [];
    expressionAttributeValues[':nullLedSuit'] = null;
    expressionAttributeValues[':nextPlayer'] = trickWinner;
    expressionAttributeValues[':team0Points'] = winnerTeam === 'team0'
      ? currentPointsCaptured.team0 + trickPoints
      : currentPointsCaptured.team0;
    expressionAttributeValues[':team1Points'] = winnerTeam === 'team1'
      ? currentPointsCaptured.team1 + trickPoints
      : currentPointsCaptured.team1;

    nextPlayer = trickWinner;
    trickComplete = true;
  } else {
    // Continue the trick - update currentTrick and currentPlayer
    updateExpression += `,
      currentTrick = :currentTrick,
      currentPlayer = :nextPlayer
    `;
    expressionAttributeValues[':currentTrick'] = updatedCurrentTrick;
    expressionAttributeValues[':nextPlayer'] = nextPlayer;

    // If this is the first card, also set the led suit
    if (currentTrick.length === 0) {
      updateExpression += ', ledSuit = :ledSuit';
      expressionAttributeValues[':ledSuit'] = currentLedSuit;
    }
  }

  // Build ExpressionAttributeNames - only include if needed
  const updateParams = {
    TableName: GAMES_TABLE,
    Key: { gameId },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression: 'version = :currentVersion',
  };

  // Only add ExpressionAttributeNames if #status is used in the update expression
  if (updateExpression.includes('#status')) {
    updateParams.ExpressionAttributeNames = {
      '#status': 'status',
    };
  }

  try {
    await docClient.send(new UpdateCommand(updateParams));
    console.log(`✅ Successfully updated game state for game ${gameId}`);

    // After successful update, if a trick was completed, immediately
    // treat the hand as complete (TESTING MODE: 1 trick = 1 hand).
    if (trickComplete) {
      // Hand is complete - calculate final scores and check for game end
      // Get updated game state first
      const updatedGameResult = await docClient.send(new GetCommand({
        TableName: GAMES_TABLE,
        Key: { gameId },
      }));
      const updatedGame = updatedGameResult.Item;
      if (updatedGame) {
        await completeHand(gameId, updatedGame);
        // completeHand already broadcasts handComplete and gameOver messages
      }
    }
  } catch (error) {
    console.error('❌ Failed to update game state:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      console.error('Version conflict - game state was updated by another request');
      return buildResponse(409, {
        error: 'Version conflict',
        message: 'Game state was updated by another player. Please try again.',
      });
    }
    return buildResponse(500, {
      error: 'Update failed',
      message: 'Failed to update game state',
    });
  }

  // Send WebSocket messages
  const localClient = global.localWebSocketClient;
  if (localClient) {
    // Ensure gameId is uppercase for consistency
    const normalizedGameId = gameId.toUpperCase();
    console.log(`📢 Broadcasting cardPlayed for game ${normalizedGameId}, seat ${playerSeat}, card ${card}`);
    try {
      // Broadcast card played
      await localClient.broadcastToGame(normalizedGameId, {
        action: 'cardPlayed',
        seat: playerSeat,
        card: card,
      });
      console.log(`✅ Broadcasted cardPlayed`);

      // Broadcast next player
      console.log(`📢 Broadcasting nextPlayer: seat ${nextPlayer}`);
      await localClient.broadcastToGame(normalizedGameId, {
        action: 'nextPlayer',
        seat: nextPlayer,
      });
      console.log(`✅ Broadcasted nextPlayer`);

      if (trickComplete) {
        const trickWinner = determineTrickWinner(updatedCurrentTrick, game.trump, currentLedSuit);
        const trickPoints = calculateTrickPoints(updatedCurrentTrick);

        console.log(`📢 Broadcasting trickWon: winner=${trickWinner}, points=${trickPoints}`);
        // Broadcast trick won
        await localClient.broadcastToGame(normalizedGameId, {
          action: 'trickWon',
          winner: trickWinner,
          points: trickPoints,
        });
        console.log(`✅ Broadcasted trickWon`);
      }
    } catch (broadcastError) {
      console.error(`❌ Error broadcasting WebSocket messages:`, broadcastError);
      // Don't fail the request if broadcast fails, but log it
    }
  } else {
    console.warn(`⚠️  localWebSocketClient not available for broadcasting`);
  }

  return buildResponse(200, {
    success: true,
  });
}

/**
 * Get the suit of a card string
 */
function getCardSuit(cardString) {
  if (cardString === 'Rook') return 'Rook';

  const suitMatch = cardString.match(/^(Red|Green|Yellow|Black)/);
  return suitMatch ? suitMatch[1] : null;
}

/**
 * Determine the winner of a trick
 */
function determineTrickWinner(currentTrick, trump, ledSuit) {
  let winningSeat = currentTrick[0].seat;
  let winningCard = currentTrick[0].card;
  let winningValue = getCardValue(winningCard, trump, ledSuit);

  for (let i = 1; i < currentTrick.length; i++) {
    const card = currentTrick[i].card;
    const value = getCardValue(card, trump, ledSuit);

    if (value > winningValue) {
      winningSeat = currentTrick[i].seat;
      winningCard = card;
      winningValue = value;
    }
  }

  return winningSeat;
}

/**
 * Get the value of a card for trick winning purposes
 */
function getCardValue(cardString, trump, ledSuit) {
  if (cardString === 'Rook') {
    // Rook is always trump, lowest value
    return 0;
  }

  const suitMatch = cardString.match(/^(Red|Green|Yellow|Black)(\d+)$/);
  if (!suitMatch) return -1;

  const suit = suitMatch[1];
  const rank = parseInt(suitMatch[2], 10);

  // Convert rank to value (1 is highest, then 14, 13, etc.)
  let rankValue;
  if (rank === 1) rankValue = 15;
  else if (rank === 14) rankValue = 14;
  else rankValue = rank;

  // If card is trump, add 100 to make it higher than any non-trump
  if (suit === trump) {
    return 100 + rankValue;
  }

  // If card is led suit, return rank value
  if (suit === ledSuit) {
    return rankValue;
  }

  // Non-trump, non-led suit cards cannot win
  return -1;
}

/**
 * Calculate points in a trick
 */
function calculateTrickPoints(currentTrick) {
  let points = 0;
  for (const play of currentTrick) {
    const card = play.card;
    if (card === 'Rook') {
      points += 20;
    } else {
      const rankMatch = card.match(/(\d+)$/);
      if (rankMatch) {
        const rank = parseInt(rankMatch[1], 10);
        if (rank === 1) points += 15;
        else if (rank === 5) points += 5;
        else if (rank === 10) points += 10;
        else if (rank === 14) points += 10;
      }
    }
  }
  return points;
}

/**
 * Check if all hands are empty (hand complete)
 */
async function checkAllHandsEmpty(gameId) {
  for (let seat = 0; seat < 4; seat++) {
    const handResult = await docClient.send(new GetCommand({
      TableName: HANDS_TABLE,
      Key: {
        gameId,
        seat,
      },
    }));

    const hand = handResult.Item;
    if (hand && hand.cards && hand.cards.length > 0) {
      return false;
    }
  }
  return true;
}

/**
 * Complete a hand and calculate final scores
 */
async function completeHand(gameId, game) {
  const pointsCaptured = game.pointsCaptured || { team0: 0, team1: 0 };
  const winningBid = game.winningBid;
  const bidWinner = game.bidWinner;
  const bidTeam = game.teams.team0.includes(bidWinner) ? 'team0' : 'team1';

  /**
   * TESTING MODE SCORING:
   * - Single trick per hand (first trick ends the hand)
   * - Team that wins the hand gets 165 points
   * - Losing team gets 15 points
   *
   * "Winner of the hand" is determined by which team captured more points
   * in this hand (pointsCaptured).
   */

  // Determine which team won the hand based on captured points
  let handWinnerTeam = 'team0';
  if (pointsCaptured.team1 > pointsCaptured.team0) {
    handWinnerTeam = 'team1';
  }

  // Fixed test scores per hand
  const WINNING_HAND_POINTS = 165;
  const LOSING_HAND_POINTS = 15;

  let handScoreTeam0 = handWinnerTeam === 'team0' ? WINNING_HAND_POINTS : LOSING_HAND_POINTS;
  let handScoreTeam1 = handWinnerTeam === 'team1' ? WINNING_HAND_POINTS : LOSING_HAND_POINTS;

  // For testing, just accumulate these fixed scores
  let team0FinalScore = (game.teamScores?.team0 || 0) + handScoreTeam0;
  let team1FinalScore = (game.teamScores?.team1 || 0) + handScoreTeam1;

  // Normal game over condition based on cumulative scores
  const gameOver = team0FinalScore >= 500 || team1FinalScore >= 500;
  const winner = gameOver ? (team0FinalScore >= 500 ? 'team0' : 'team1') : null;

  // Get or initialize hand history
  const handHistory = game.handHistory || [];
  const currentRound = (game.currentRound || 0) + 1;

  // Testing mode: we are not using shoot-the-moon logic, but keep the
  // field for compatibility with existing frontend types.
  const shootTheMoon = false;

  // Whether the bid team effectively "made their bid" in this test mode
  const madeBid = handWinnerTeam === bidTeam;

  // Determine next dealer (rotate seats each hand). If dealer is not set
  // yet, assume seat 0 was the previous dealer.
  const currentDealer = typeof game.dealer === 'number' ? game.dealer : 0;
  const nextDealer = (currentDealer + 1) % 4;

  // Add this hand to history
  handHistory.push({
    round: currentRound,
    bid: winningBid,
    bidTeam: bidTeam,
    madeBid: madeBid,
    team0Points: pointsCaptured.team0,
    team1Points: pointsCaptured.team1,
    team0HandScore: handScoreTeam0,
    team1HandScore: handScoreTeam1,
    team0Total: team0FinalScore,
    team1Total: team1FinalScore,
    shootTheMoon: shootTheMoon,
  });

  // Update game state with final scores and hand history
  await docClient.send(new UpdateCommand({
    TableName: GAMES_TABLE,
    Key: { gameId },
    // Set the entire teamScores map in one go to avoid invalid nested
    // document path errors if teamScores doesn't exist yet.
    UpdateExpression: `
      SET teamScores = :teamScores,
          handHistory = :handHistory,
          pointsCaptured = :resetPoints,
          dealer = :dealer,
          currentRound = :currentRound,
          version = version + :one,
          updatedAt = :updatedAt
    `,
    ExpressionAttributeValues: {
      ':teamScores': {
        team0: team0FinalScore,
        team1: team1FinalScore,
      },
      ':handHistory': handHistory,
      ':resetPoints': { team0: 0, team1: 0 },
      ':dealer': nextDealer,
      ':currentRound': currentRound,
      ':one': 1,
      ':updatedAt': new Date().toISOString(),
      ':currentVersion': game.version,
    },
    ConditionExpression: 'version = :currentVersion',
  }));

  // Broadcast hand complete
  const localClient = global.localWebSocketClient;
  if (localClient) {
    const normalizedGameId = gameId.toUpperCase();
    await localClient.broadcastToGame(normalizedGameId, {
      action: 'handComplete',
      team0Points: pointsCaptured.team0,
      team1Points: pointsCaptured.team1,
      team0HandScore: handScoreTeam0,
      team1HandScore: handScoreTeam1,
      team0Total: team0FinalScore,
      team1Total: team1FinalScore,
      bid: winningBid,
      bidTeam: bidTeam,
      madeBid: madeBid,
      shootTheMoon: shootTheMoon,
      dealer: nextDealer,
      gameOver,
      winner,
      handHistory: handHistory,
    });

    if (gameOver && winner) {
      await localClient.broadcastToGame(normalizedGameId, {
        action: 'gameOver',
        winner: winner,
      });
    }
  }

  return { gameOver, winner };
}

module.exports = { handler };