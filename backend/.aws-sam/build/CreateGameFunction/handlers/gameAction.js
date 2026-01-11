/**
 * GameAction Lambda Handler
 *
 * Handles in-game actions: playCard, bid, pass, discardAndTrump, quickChat
 *
 * WebSocket API: $default route (via websocketRouter)
 * Request body: { "gameId": "ABCDEF", "playerName": "PlayerName", "action": "...", ... }
 */

const { GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, HANDS_TABLE, CONNECTIONS_TABLE } = require('../shared/dynamodb');
const { GameStatus, BID_MIN, buildResponse } = require('../shared/gameUtils');
const { isBot } = require('../shared/botUtils');
const { scheduleBotAction } = require('../shared/botUtils');

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

/**
 * Calculate points from an array of cards
 */
function calculateCardPoints(cards) {
  let points = 0;
  for (const card of cards) {
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

    if (!gameId || !action) {
      return buildResponse(400, {
        error: 'Missing required fields',
        message: 'gameId and action are required',
      });
    }

    const normalizedGameId = gameId.toUpperCase();

    // Parallelize: Get player connections and game state simultaneously
    const [connectionsResult, gameResult] = await Promise.all([
      docClient.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        KeyConditionExpression: 'gameId = :gameId',
        ExpressionAttributeValues: {
          ':gameId': normalizedGameId,
        },
      })),
      docClient.send(new GetCommand({
        TableName: GAMES_TABLE,
        Key: { gameId: normalizedGameId },
      })),
    ]);

    // Find player by name if provided, otherwise use connection info from event
    let playerSeat = null;
    let connectionId = null;

    // First, try to get from WebSocket event context (connectionId is most reliable)
    if (event.requestContext?.connectionId) {
      connectionId = event.requestContext.connectionId;
      const connFromEvent = connectionsResult.Items?.find(c => c.connectionId === connectionId);
      if (connFromEvent) {
        playerSeat = connFromEvent.seat;
      }
    }

    // If not found by connectionId, try by playerName
    if (playerSeat === null && playerName) {
      const playerConnection = connectionsResult.Items?.find(c => c.playerName === playerName);
      if (playerConnection) {
        playerSeat = playerConnection.seat;
        connectionId = playerConnection.connectionId;
      }
    }

    if (playerSeat === null) {
      return buildResponse(404, {
        error: 'Player not found',
        message: 'Player connection not found in game',
      });
    }

    const game = gameResult.Item;
    if (!game) {
      return buildResponse(404, {
        error: 'Game not found',
        message: 'The specified game does not exist',
      });
    }

    // Create API Gateway client for WebSocket messaging
    const apiGatewayClient = createApiGatewayClient(event);

    // Handle different actions
    switch (action) {
      case 'playCard':
        return await handlePlayCard(game, playerSeat, body.card, connectionId, apiGatewayClient, event);

      case 'bid':
        return await handleBid(game, playerSeat, body.amount, connectionId, apiGatewayClient, event);

      case 'pass':
        return await handlePass(game, playerSeat, connectionId, apiGatewayClient, event);

      case 'discardAndTrump':
        return await handleDiscardAndTrump(game, playerSeat, body.discard, body.trump, connectionId, apiGatewayClient, event);

      case 'quickChat':
        return await handleQuickChat(game, playerSeat, body.message, apiGatewayClient, event);

      case 'resync':
        return await handleResync(game, playerSeat, connectionId, apiGatewayClient, event);

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
 * Handle bid action
 */
async function handleBid(game, playerSeat, amount, connectionId, apiGatewayClient, event) {
  const gameId = game.gameId;

  // Verify game is in BIDDING status
  if (game.status !== GameStatus.BIDDING) {
    return buildResponse(400, {
      error: 'Invalid game state',
      message: 'Game is not in bidding phase',
    });
  }

  // Initialize passed array if it doesn't exist
  const passed = game.passed || [];

  // Check if player has already passed
  if (passed.includes(playerSeat)) {
    return buildResponse(400, {
      error: 'Already passed',
      message: 'You have already passed',
    });
  }

  // Verify it's this player's turn
  if (game.currentBidder !== playerSeat) {
    return buildResponse(400, {
      error: 'Not your turn',
      message: 'It is not your turn to bid',
    });
  }

  // Validate bid amount
  const highBid = game.highBid || 0;
  let isValid = false;
  if (highBid === 0) {
    isValid = amount >= BID_MIN && amount % 5 === 0;
  } else {
    isValid = amount >= highBid + 5 && amount % 5 === 0;
  }

  if (!isValid) {
    return buildResponse(400, {
      error: 'Invalid bid',
      message: `Bid must be at least ${highBid === 0 ? BID_MIN : highBid + 5} and a multiple of 5`,
    });
  }

  // Find next bidder (skip passed players)
  const passedSet = new Set(passed);
  let nextBidder = (playerSeat + 1) % 4;
  while (passedSet.has(nextBidder) && nextBidder !== playerSeat) {
    nextBidder = (nextBidder + 1) % 4;
  }

  // Check if bidding should end (all others passed)
  if (nextBidder === playerSeat) {
    // Bidding ends - this player wins
    await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
      UpdateExpression: `
        SET highBid = :highBid,
            highBidder = :highBidder,
            bidWinner = :bidWinner,
            winningBid = :winningBid,
            #status = :status,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':highBid': amount,
        ':highBidder': playerSeat,
        ':bidWinner': playerSeat,
        ':winningBid': amount,
        ':status': GameStatus.TRUMP_SELECTION,
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
        ':currentVersion': game.version,
      },
      ConditionExpression: 'version = :currentVersion',
    }));

    // Send kitty cards to winner and update their hand
    if (game.kitty && Array.isArray(game.kitty) && game.kitty.length === 5) {
      const handResult = await docClient.send(new GetCommand({
        TableName: HANDS_TABLE,
        Key: { gameId, seat: playerSeat },
      }));

      const currentHand = handResult.Item;
      if (currentHand && currentHand.cards) {
        const updatedHand = [...currentHand.cards, ...game.kitty];
        await docClient.send(new UpdateCommand({
          TableName: HANDS_TABLE,
          Key: { gameId, seat: playerSeat },
          UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':cards': updatedHand,
            ':updatedAt': new Date().toISOString(),
          },
        }));
      }

      // Send kitty to winner
      await sendToPlayer(apiGatewayClient, gameId, playerSeat, {
        action: 'kitty',
        cards: game.kitty,
      });
    }

    // Broadcast bidding won
    await broadcastToGame(apiGatewayClient, gameId, {
      action: 'biddingWon',
      winner: playerSeat,
      amount: amount,
    });

    // Check if bid winner is a bot - they need to select trump after receiving kitty
    // Use game object already in memory (players don't change during action)
    if (isBot(game.players, playerSeat)) {
      // Bot will receive kitty first, then select trump
      // Schedule bot action after a short delay to allow kitty to be sent
      await scheduleBotAction(gameId, playerSeat, 1500);
    }
  } else {
    // Continue bidding
    await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
      UpdateExpression: `
        SET highBid = :highBid,
            highBidder = :highBidder,
            currentBidder = :currentBidder,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeValues: {
        ':highBid': amount,
        ':highBidder': playerSeat,
        ':currentBidder': nextBidder,
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
        ':currentVersion': game.version,
      },
      ConditionExpression: 'version = :currentVersion',
    }));

    // Broadcast bid placed with next bidder info in same message (reduces DB queries and API calls)
    const connections = await getGameConnections(gameId);
    await broadcastToGame(apiGatewayClient, gameId, {
      action: 'bidPlaced',
      seat: playerSeat,
      amount: amount,
      nextBidder: nextBidder,
    }, connections);

    // Check if next bidder is a bot and schedule bot action
    // Use game object already in memory (players don't change during action)
    const isNextBidderBot = isBot(game.players, nextBidder);
    console.log(`[GAME_ACTION] After bid: nextBidder=${nextBidder}, isBot=${isNextBidderBot}, players:`, game.players.map(p => `${p.name}(${p.seat},isBot:${p.isBot})`).join(', '));
    if (isNextBidderBot) {
      console.log(`[GAME_ACTION] Scheduling bot action for seat ${nextBidder}`);
      await scheduleBotAction(gameId, nextBidder, 1000);
    }
  }

  return buildResponse(200, { success: true });
}

/**
 * Handle pass action
 */
async function handlePass(game, playerSeat, connectionId, apiGatewayClient, event) {
  const gameId = game.gameId;

  // Verify game is in BIDDING status
  if (game.status !== GameStatus.BIDDING) {
    return buildResponse(400, {
      error: 'Invalid game state',
      message: 'Game is not in bidding phase',
    });
  }

  const passed = game.passed || [];

  // Check if player has already passed
  if (passed.includes(playerSeat)) {
    return buildResponse(400, {
      error: 'Already passed',
      message: 'You have already passed',
    });
  }

  // Verify it's this player's turn
  if (game.currentBidder !== playerSeat) {
    return buildResponse(400, {
      error: 'Not your turn',
      message: 'It is not your turn to bid',
    });
  }

  const newPassed = [...passed, playerSeat];
  const passedSet = new Set(newPassed);

  // Find next bidder (skip passed players)
  let nextBidder = (playerSeat + 1) % 4;
  while (passedSet.has(nextBidder) && nextBidder !== playerSeat) {
    nextBidder = (nextBidder + 1) % 4;
  }

  // Check if only one player remains (bidding ends)
  if (newPassed.length === 3 || nextBidder === playerSeat) {
    const remainingPlayer = [0, 1, 2, 3].find(seat => !passedSet.has(seat));
    const highBid = game.highBid || 0;
    const winningBid = highBid > 0 ? highBid : BID_MIN;

    await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
      UpdateExpression: `
        SET passed = :passed,
            bidWinner = :bidWinner,
            winningBid = :winningBid,
            highBid = :highBid,
            highBidder = :highBidder,
            #status = :status,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':passed': newPassed,
        ':bidWinner': remainingPlayer,
        ':winningBid': winningBid,
        ':highBid': winningBid,
        ':highBidder': remainingPlayer,
        ':status': GameStatus.TRUMP_SELECTION,
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
        ':currentVersion': game.version,
      },
      ConditionExpression: 'version = :currentVersion',
    }));

    // Send kitty cards to winner
    if (game.kitty && Array.isArray(game.kitty) && game.kitty.length === 5) {
      const handResult = await docClient.send(new GetCommand({
        TableName: HANDS_TABLE,
        Key: { gameId, seat: remainingPlayer },
      }));

      const currentHand = handResult.Item;
      if (currentHand && currentHand.cards) {
        const updatedHand = [...currentHand.cards, ...game.kitty];
        await docClient.send(new UpdateCommand({
          TableName: HANDS_TABLE,
          Key: { gameId, seat: remainingPlayer },
          UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':cards': updatedHand,
            ':updatedAt': new Date().toISOString(),
          },
        }));
      }

      await sendToPlayer(apiGatewayClient, gameId, remainingPlayer, {
        action: 'kitty',
        cards: game.kitty,
      });
    }

    // Broadcast bidding won
    await broadcastToGame(apiGatewayClient, gameId, {
      action: 'biddingWon',
      winner: remainingPlayer,
      amount: winningBid,
    });

    // Check if bid winner is a bot - they need to select trump after receiving kitty
    // Use game object already in memory (players don't change during action)
    if (isBot(game.players, remainingPlayer)) {
      // Bot will receive kitty first, then select trump
      // Schedule bot action after a short delay to allow kitty to be sent
      await scheduleBotAction(gameId, remainingPlayer, 1500);
    }
  } else {
    // Continue bidding
    await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
      UpdateExpression: `
        SET passed = :passed,
            currentBidder = :currentBidder,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeValues: {
        ':passed': newPassed,
        ':currentBidder': nextBidder,
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
        ':currentVersion': game.version,
      },
      ConditionExpression: 'version = :currentVersion',
    }));

    // Broadcast player passed with next bidder info in same message (reduces DB queries and API calls)
    const connections = await getGameConnections(gameId);
    await broadcastToGame(apiGatewayClient, gameId, {
      action: 'playerPassed',
      seat: playerSeat,
      nextBidder: nextBidder,
    }, connections);

    // Check if next bidder is a bot and schedule bot action
    // Use game object already in memory (players don't change during action)
    const isNextBidderBot = isBot(game.players, nextBidder);
    console.log(`[GAME_ACTION] After pass: nextBidder=${nextBidder}, isBot=${isNextBidderBot}, players:`, game.players.map(p => `${p.name}(${p.seat},isBot:${p.isBot})`).join(', '));
    if (isNextBidderBot) {
      console.log(`[GAME_ACTION] Scheduling bot action for seat ${nextBidder}`);
      await scheduleBotAction(gameId, nextBidder, 1000);
    }
  }

  return buildResponse(200, { success: true });
}

/**
 * Handle discard and trump selection
 */
async function handleDiscardAndTrump(game, playerSeat, discard, trump, connectionId, apiGatewayClient, event) {
  const gameId = game.gameId;

  // Verify game is in TRUMP_SELECTION status
  if (game.status !== GameStatus.TRUMP_SELECTION) {
    return buildResponse(400, {
      error: 'Invalid game state',
      message: 'Game is not in trump selection phase',
    });
  }

  // Verify this is the bid winner
  if (game.bidWinner !== playerSeat) {
    return buildResponse(400, {
      error: 'Not authorized',
      message: 'Only the bid winner can select trump',
    });
  }

  // Validate discard array
  if (!Array.isArray(discard) || discard.length !== 5) {
    return buildResponse(400, {
      error: 'Invalid discard',
      message: 'Must discard exactly 5 cards',
    });
  }

  // Validate trump suit
  const validSuits = ['Red', 'Green', 'Yellow', 'Black'];
  if (!validSuits.includes(trump)) {
    return buildResponse(400, {
      error: 'Invalid trump',
      message: 'Trump must be Red, Green, Yellow, or Black',
    });
  }

  // Get player's current hand
  const handResult = await docClient.send(new GetCommand({
    TableName: HANDS_TABLE,
    Key: { gameId, seat: playerSeat },
  }));

  const hand = handResult.Item;
  if (!hand || !hand.cards) {
    return buildResponse(500, {
      error: 'Hand not found',
      message: 'Player hand could not be retrieved',
    });
  }

  // Player should have 18 cards (13 + 5 kitty)
  if (hand.cards.length !== 18) {
    return buildResponse(400, {
      error: 'Invalid hand size',
      message: 'Please wait for kitty cards',
    });
  }

  // Validate that all discard cards are in the player's hand
  const handSet = new Set(hand.cards);
  const validDiscard = discard.every(card => handSet.has(card));

  if (!validDiscard) {
    return buildResponse(400, {
      error: 'Invalid discard',
      message: 'Some discard cards are not in your hand',
    });
  }

  // Remove discarded cards from hand
  const newHandCards = hand.cards.filter(card => !discard.includes(card));

  if (newHandCards.length !== 13) {
    return buildResponse(500, {
      error: 'Discard error',
      message: 'Unexpected hand size after discard',
    });
  }

  // Update player's hand
  await docClient.send(new UpdateCommand({
    TableName: HANDS_TABLE,
    Key: { gameId, seat: playerSeat },
    UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':cards': newHandCards,
      ':updatedAt': new Date().toISOString(),
    },
  }));

  // Calculate kitty points from discarded cards
  const kittyPointsCaptured = calculateCardPoints(discard);

  // Calculate first trick leader: player to the left of dealer
  const dealer = typeof game.dealer === 'number' ? game.dealer : 0;
  const firstTrickLeader = (dealer + 1) % 4;

  // Update game state
  await docClient.send(new UpdateCommand({
    TableName: GAMES_TABLE,
    Key: { gameId },
    UpdateExpression: `
      SET trump = :trump,
          #status = :status,
          currentPlayer = :currentPlayer,
          kittyPointsCaptured = :kittyPointsCaptured,
          currentTrick = :emptyTrick,
          ledSuit = :nullLedSuit,
          version = version + :one,
          updatedAt = :updatedAt
    `,
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':trump': trump,
      ':status': GameStatus.PLAYING,
      ':currentPlayer': firstTrickLeader,
      ':kittyPointsCaptured': kittyPointsCaptured,
      ':emptyTrick': [],
      ':nullLedSuit': null,
      ':one': 1,
      ':updatedAt': new Date().toISOString(),
      ':currentVersion': game.version,
    },
    ConditionExpression: 'version = :currentVersion',
  }));

  // Broadcast trump chosen with play start info in same message (reduces DB queries and API calls)
  const connections = await getGameConnections(gameId);
  await broadcastToGame(apiGatewayClient, gameId, {
    action: 'trumpChosen',
    suit: trump,
    leader: firstTrickLeader,
  }, connections);

  // Check if first trick leader is a bot and schedule bot action
  // Use game object already in memory (players don't change during action)
  if (isBot(game.players, firstTrickLeader)) {
    await scheduleBotAction(gameId, firstTrickLeader, 1000);
  }

  return buildResponse(200, { success: true });
}

/**
 * Handle quick chat
 */
async function handleQuickChat(game, playerSeat, message, apiGatewayClient, event) {
  const gameId = game.gameId;

  if (!message) {
    return buildResponse(400, {
      error: 'Invalid message',
      message: 'Message is required',
    });
  }

  // Broadcast quick chat to all players
  await broadcastToGame(apiGatewayClient, gameId, {
    action: 'quickChat',
    seat: playerSeat,
    message: message,
  });

  return buildResponse(200, { success: true });
}

/**
 * Handle playing a card
 */
async function handlePlayCard(game, playerSeat, card, connectionId, apiGatewayClient, event) {
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
    Key: { gameId, seat: playerSeat },
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
      if (cardSuit !== ledSuit && !(cardSuit === 'Rook' && ledSuit === trumpSuit)) {
        return buildResponse(400, {
          error: 'Must follow suit',
          message: `You must play a card of the led suit (${ledSuit})`,
        });
      }
    }
  }

  // Card is valid - prepare to remove it from player's hand
  let updatedHandCards = hand.cards.filter(c => c !== card);
  
  // Retry logic for handling race conditions with concurrent bot actions
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let updateSucceeded = false;
  let updatedGame = game;
  let nextPlayer;
  let trickComplete;
  let trickWinner;
  let trickPoints;

  while (!updateSucceeded && retryCount < MAX_RETRIES) {
    try {
      // Update game state with the played card
      const currentTrickForUpdate = updatedGame.currentTrick || [];
      const ledSuitForUpdate = updatedGame.ledSuit;
      const updatedCurrentTrick = [...currentTrickForUpdate, { seat: playerSeat, card }];

      // If this is the first card of the trick, set the led suit
      let currentLedSuit = ledSuitForUpdate;
      if (currentTrickForUpdate.length === 0) {
        const cardSuit = getCardSuit(card);
        currentLedSuit = cardSuit === 'Rook' ? updatedGame.trump : cardSuit;
      }

      // Determine if this completes the trick (4 cards played)
      nextPlayer = (playerSeat + 1) % 4;
      trickComplete = false;
      trickWinner = null;
      trickPoints = 0;

      // Build update expression
      let updateExpression = 'SET version = version + :one, updatedAt = :updatedAt, cardsPlayed = list_append(if_not_exists(cardsPlayed, :emptyList), :newCard)';
      let expressionAttributeValues = {
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
        ':currentVersion': updatedGame.version,
        ':emptyList': [],
        ':newCard': [card],
      };

      if (updatedCurrentTrick.length === 4) {
        // Trick is complete
        trickWinner = determineTrickWinner(updatedCurrentTrick, updatedGame.trump, currentLedSuit);
        trickPoints = calculateTrickPoints(updatedCurrentTrick);

        const winnerTeam = updatedGame.teams.team0.includes(trickWinner) ? 'team0' : 'team1';
        const currentPointsCaptured = updatedGame.pointsCaptured || { team0: 0, team1: 0 };

        updateExpression += `, currentTrick = :emptyTrick, ledSuit = :nullLedSuit, currentPlayer = :nextPlayer`;
        updateExpression += `, pointsCaptured.team0 = :team0Points, pointsCaptured.team1 = :team1Points`;

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
        updateExpression += `, currentTrick = :currentTrick, currentPlayer = :nextPlayer`;
        expressionAttributeValues[':currentTrick'] = updatedCurrentTrick;
        expressionAttributeValues[':nextPlayer'] = nextPlayer;

        if (currentTrickForUpdate.length === 0) {
          updateExpression += ', ledSuit = :ledSuit';
          expressionAttributeValues[':ledSuit'] = currentLedSuit;
        }
      }

      // Try to update the game state
      await docClient.send(new UpdateCommand({
        TableName: GAMES_TABLE,
        Key: { gameId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'version = :currentVersion',
      }));

      // If we get here, the update succeeded
      updateSucceeded = true;

      // Now update the hand (only after game update succeeds)
      await docClient.send(new UpdateCommand({
        TableName: HANDS_TABLE,
        Key: { gameId, seat: playerSeat },
        UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':cards': updatedHandCards,
          ':updatedAt': new Date().toISOString(),
        },
      }));

    } catch (error) {
      // Check if it's a conditional check failed exception
      if (error.name === 'ConditionalCheckFailedException' || 
          (error.$fault === 'client' && error.__type?.includes('ConditionalCheckFailedException'))) {
        retryCount++;
        
        if (retryCount >= MAX_RETRIES) {
          console.error(`[GAME_ACTION] Max retries reached for playCard, gameId: ${gameId}, seat: ${playerSeat}`);
          return buildResponse(409, {
            error: 'Concurrent update conflict',
            message: 'The game state changed while processing your action. Please try again.',
          });
        }

        // Re-read game state for retry
        const retryGameResult = await docClient.send(new GetCommand({
          TableName: GAMES_TABLE,
          Key: { gameId },
        }));

        updatedGame = retryGameResult.Item;
        if (!updatedGame) {
          return buildResponse(404, {
            error: 'Game not found',
            message: 'Game no longer exists',
          });
        }

        // Verify it's still this player's turn
        if (updatedGame.currentPlayer !== playerSeat) {
          console.log(`[GAME_ACTION] Player ${playerSeat} is no longer the current player (current: ${updatedGame.currentPlayer})`);
          return buildResponse(400, {
            error: 'Not your turn',
            message: 'It is no longer your turn to play',
          });
        }

        // Re-read hand to ensure card is still valid
        const retryHandResult = await docClient.send(new GetCommand({
          TableName: HANDS_TABLE,
          Key: { gameId, seat: playerSeat },
        }));

        const retryHand = retryHandResult.Item;
        if (!retryHand || !retryHand.cards || !retryHand.cards.includes(card)) {
          return buildResponse(400, {
            error: 'Invalid card',
            message: 'Card is no longer in your hand',
          });
        }

        // Update hand cards for next retry attempt
        updatedHandCards = retryHand.cards.filter(c => c !== card);

        // Add a small delay before retrying to reduce contention
        await new Promise(resolve => setTimeout(resolve, 50 * retryCount));
        continue;
      } else {
        // Some other error - rethrow it
        throw error;
      }
    }
  }

  // Safety check: ensure update succeeded
  if (!updateSucceeded) {
    console.error(`[GAME_ACTION] Update failed after ${retryCount} retries for playCard, gameId: ${gameId}, seat: ${playerSeat}`);
    return buildResponse(409, {
      error: 'Update failed',
      message: 'Failed to update game state after multiple retries',
    });
  }

  // Send WebSocket message with next player info (reduces DB queries and API calls)
  const connections = await getGameConnections(gameId);
  await broadcastToGame(apiGatewayClient, gameId, {
    action: 'cardPlayed',
    seat: playerSeat,
    card: card,
    nextPlayer: nextPlayer,
  }, connections);

  // Check if next player is a bot and schedule bot action
  // Use game object already in memory (players don't change during action)
  if (trickComplete) {
    await broadcastToGame(apiGatewayClient, gameId, {
      action: 'trickWon',
      winner: trickWinner,
      points: trickPoints,
    }, connections);

    // Check if hand is complete
    const allHandsEmpty = await checkAllHandsEmpty(gameId);
    if (allHandsEmpty) {
      // Need to read game state for completeHand as it needs updated scores
      const updatedGameResult = await docClient.send(new GetCommand({
        TableName: GAMES_TABLE,
        Key: { gameId },
      }));
      const updatedGame = updatedGameResult.Item;
      if (updatedGame) {
        const { gameOver } = await completeHand(gameId, updatedGame, apiGatewayClient);
        
        // If game is not over and next dealer is a bot, schedule bot to start next hand
        if (!gameOver) {
          const currentDealer = typeof updatedGame.dealer === 'number' ? updatedGame.dealer : 0;
          const nextDealer = (currentDealer + 1) % 4;
          
          if (isBot(updatedGame.players, nextDealer)) {
            console.log(`[GAME_ACTION] Next dealer (seat ${nextDealer}) is a bot - scheduling startNextHand`);
            // Use longer delay to allow hand completion UI to show
            await scheduleBotAction(gameId, nextDealer, 5000);
          }
        }
      }
    } else {
      // If trick complete but hand not over, check if trick winner (next leader) is a bot
      // Use longer delay (2.5s) to allow UI animation to complete before next card is played
      if (isBot(game.players, trickWinner)) {
        await scheduleBotAction(gameId, trickWinner, 4000);
      }
    }
  } else {
    // Regular card play (trick not complete) - schedule bot action for next player
    if (isBot(game.players, nextPlayer)) {
      await scheduleBotAction(gameId, nextPlayer, 1000);
    }
  }

  return buildResponse(200, { success: true });
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
  let winningValue = getCardValue(currentTrick[0].card, trump, ledSuit);

  for (let i = 1; i < currentTrick.length; i++) {
    const value = getCardValue(currentTrick[i].card, trump, ledSuit);
    if (value > winningValue) {
      winningSeat = currentTrick[i].seat;
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
    // Rook is ALWAYS trump (lowest trump card)
    // Returns 100 to indicate trump-level (beats any non-trump)
    // but lower than any regular trump card (100 + rank where rank >= 1)
    return 100;
  }

  const suitMatch = cardString.match(/^(Red|Green|Yellow|Black)(\d+)$/);
  if (!suitMatch) return -1;

  const suit = suitMatch[1];
  const rank = parseInt(suitMatch[2], 10);

  let rankValue;
  if (rank === 1) rankValue = 15;
  else if (rank === 14) rankValue = 14;
  else rankValue = rank;

  if (suit === trump) return 100 + rankValue;
  if (suit === ledSuit) return rankValue;
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
      Key: { gameId, seat },
    }));
    if (handResult.Item?.cards?.length > 0) return false;
  }
  return true;
}

/**
 * Complete a hand and calculate final scores
 */
async function completeHand(gameId, game, apiGatewayClient) {
  const pointsCaptured = game.pointsCaptured || { team0: 0, team1: 0 };
  const winningBid = game.winningBid;
  const bidWinner = game.bidWinner;
  const bidTeam = game.teams.team0.includes(bidWinner) ? 'team0' : 'team1';
  const kittyPointsCaptured = game.kittyPointsCaptured || 0;

  const bidTeamTotalPoints = pointsCaptured[bidTeam] + kittyPointsCaptured;
  const defenderTeam = bidTeam === 'team0' ? 'team1' : 'team0';
  const defenderTeamPoints = pointsCaptured[defenderTeam];

  const madeBid = bidTeamTotalPoints >= winningBid;
  const TOTAL_POINTS = 180;
  const isSweep = defenderTeamPoints === 0 && bidTeamTotalPoints === TOTAL_POINTS;

  let handScoreBidTeam = 0;
  let handScoreDefenderTeam = defenderTeamPoints;

  if (madeBid) {
    handScoreBidTeam = isSweep ? 200 : bidTeamTotalPoints;
  } else {
    handScoreBidTeam = -winningBid;
  }

  let handScoreTeam0 = bidTeam === 'team0' ? handScoreBidTeam : handScoreDefenderTeam;
  let handScoreTeam1 = bidTeam === 'team1' ? handScoreBidTeam : handScoreDefenderTeam;

  let team0FinalScore = (game.teamScores?.team0 || 0) + handScoreTeam0;
  let team1FinalScore = (game.teamScores?.team1 || 0) + handScoreTeam1;

  let gameOver = false;
  let winner = null;

  if (team0FinalScore >= 500 && team1FinalScore >= 500) {
    if (team0FinalScore > team1FinalScore) {
      gameOver = true;
      winner = 'team0';
    } else if (team1FinalScore > team0FinalScore) {
      gameOver = true;
      winner = 'team1';
    }
  } else if (team0FinalScore >= 500) {
    gameOver = true;
    winner = 'team0';
  } else if (team1FinalScore >= 500) {
    gameOver = true;
    winner = 'team1';
  }

  const handHistory = game.handHistory || [];
  const currentRound = (game.currentRound || 0) + 1;
  const currentDealer = typeof game.dealer === 'number' ? game.dealer : 0;
  const nextDealer = (currentDealer + 1) % 4;

  handHistory.push({
    round: currentRound,
    bid: winningBid,
    bidTeam,
    madeBid,
    team0Points: pointsCaptured.team0,
    team1Points: pointsCaptured.team1,
    team0HandScore: handScoreTeam0,
    team1HandScore: handScoreTeam1,
    team0Total: team0FinalScore,
    team1Total: team1FinalScore,
    shootTheMoon: isSweep,
  });

  const updateParams = {
    TableName: GAMES_TABLE,
    Key: { gameId },
    ExpressionAttributeValues: {
      ':teamScores': { team0: team0FinalScore, team1: team1FinalScore },
      ':handHistory': handHistory,
      ':resetPoints': { team0: 0, team1: 0 },
      ':dealer': nextDealer,
      ':currentRound': currentRound,
      ':one': 1,
      ':updatedAt': new Date().toISOString(),
      ':currentVersion': game.version,
    },
    ConditionExpression: 'version = :currentVersion',
  };

  if (gameOver) {
    updateParams.UpdateExpression = `
      SET teamScores = :teamScores, handHistory = :handHistory, pointsCaptured = :resetPoints,
          dealer = :dealer, currentRound = :currentRound, #status = :status,
          version = version + :one, updatedAt = :updatedAt
    `;
    updateParams.ExpressionAttributeNames = { '#status': 'status' };
    updateParams.ExpressionAttributeValues[':status'] = GameStatus.FINISHED;
  } else {
    updateParams.UpdateExpression = `
      SET teamScores = :teamScores, handHistory = :handHistory, pointsCaptured = :resetPoints,
          dealer = :dealer, currentRound = :currentRound,
          version = version + :one, updatedAt = :updatedAt
    `;
  }

  await docClient.send(new UpdateCommand(updateParams));

  await broadcastToGame(apiGatewayClient, gameId, {
    action: 'handComplete',
    team0Points: pointsCaptured.team0,
    team1Points: pointsCaptured.team1,
    team0HandScore: handScoreTeam0,
    team1HandScore: handScoreTeam1,
    team0Total: team0FinalScore,
    team1Total: team1FinalScore,
    bid: winningBid,
    bidTeam,
    madeBid,
    shootTheMoon: isSweep,
    dealer: nextDealer,
    gameOver,
    winner,
    handHistory,
  });

  if (gameOver && winner) {
    await broadcastToGame(apiGatewayClient, gameId, {
      action: 'gameOver',
      winner,
    });
  }

  return { gameOver, winner };
}

/**
 * Handle resync action - sends full game state to a reconnecting player
 */
async function handleResync(game, playerSeat, connectionId, apiGatewayClient, event) {
  const gameId = game.gameId;

  console.log(`[RESYNC] Player at seat ${playerSeat} requesting resync for game ${gameId}`);

  try {
    // Get player's current hand
    const handResult = await docClient.send(new GetCommand({
      TableName: HANDS_TABLE,
      Key: { gameId, seat: playerSeat },
    }));

    const hand = handResult.Item;
    const cards = hand?.cards || [];

    // Build the resync response with all relevant game state
    const resyncData = {
      action: 'resync',
      gameId: game.gameId,
      status: game.status,
      players: game.players || [],
      teams: game.teams || null,
      dealer: game.dealer,
      
      // Player's hand
      cards: cards,
      
      // Bidding state
      currentBidder: game.currentBidder,
      highBid: game.highBid || 0,
      passed: game.passed || [],
      bidWinner: game.bidWinner,
      winningBid: game.winningBid,
      
      // Trump and play state
      trump: game.trump,
      currentPlayer: game.currentPlayer,
      currentTrick: game.currentTrick || [],
      ledSuit: game.ledSuit,
      
      // Scores
      teamScores: game.teamScores || { team0: 0, team1: 0 },
      pointsCaptured: game.pointsCaptured || { team0: 0, team1: 0 },
      handHistory: game.handHistory || [],
      
      // Kitty (only for bid winner in TRUMP_SELECTION who hasn't discarded yet)
      kitty: (game.status === 'TRUMP_SELECTION' && playerSeat === game.bidWinner && cards.length === 18) 
        ? null  // Already have kitty merged into hand
        : (game.status === 'TRUMP_SELECTION' && playerSeat === game.bidWinner && cards.length < 18)
          ? game.kitty  // Need to send kitty cards
          : null,
    };

    // Send resync data directly to this player
    await sendToPlayer(apiGatewayClient, gameId, playerSeat, resyncData);

    console.log(`[RESYNC] Sent resync data to player at seat ${playerSeat}:`, {
      status: resyncData.status,
      cardCount: cards.length,
      hasTeams: !!resyncData.teams,
      currentPlayer: resyncData.currentPlayer,
      trickSize: resyncData.currentTrick.length,
    });

    return buildResponse(200, { success: true });

  } catch (error) {
    console.error('[RESYNC] Error handling resync:', error);
    return buildResponse(500, {
      error: 'Resync failed',
      message: 'Failed to send game state',
    });
  }
}

module.exports = { handler };
