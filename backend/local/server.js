/**
 * Local Development Server
 * 
 * Simulates API Gateway by exposing Lambda handlers as HTTP endpoints.
 * Also includes a WebSocket server for real-time game communication.
 * Uses DynamoDB Local for database.
 * 
 * Usage: node local/server.js
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { URL } = require('url');
const { handler: createGame } = require('../handlers/createGame');
const { handler: joinGame } = require('../handlers/joinGame');
const { handler: choosePartner } = require('../handlers/choosePartner');
const { handler: gameAction } = require('../handlers/gameAction');
const { handler: startNextHand } = require('../handlers/startNextHand');
const { PutCommand, DeleteCommand, QueryCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, CONNECTIONS_TABLE, GAMES_TABLE, HANDS_TABLE } = require('../shared/dynamodb');
const { GameStatus, BID_MIN } = require('../shared/gameUtils');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// In-memory store for WebSocket connections (for local dev)
// Maps connectionId -> { ws, gameId, playerName, seat }
const wsConnections = new Map();

/**
 * Handle trump selection and discard action
 */
async function handleDiscardAndTrump(connectionInfo, message) {
  const { gameId, seat: playerSeat } = connectionInfo;

  if (playerSeat === null || playerSeat === undefined) {
    console.error('Cannot handle discard and trump: player seat not set');
    return;
  }

  try {
    // Get current game state
    const gameResult = await docClient.send(new GetCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
    }));

    const game = gameResult.Item;
    if (!game) {
      console.error(`Game ${gameId} not found`);
      return;
    }

    if (game.status !== GameStatus.TRUMP_SELECTION) {
      console.error(`Game ${gameId} is not in TRUMP_SELECTION status`);
      return;
    }

    // Verify this is the bid winner
    if (game.bidWinner !== playerSeat) {
      console.warn(`Player ${playerSeat} is not the bid winner (${game.bidWinner})`);
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify({
          action: 'discardError',
          message: 'You are not the bid winner',
        }));
      }
      return;
    }

    const { discard, trump } = message;

    // Validate discard array
    if (!Array.isArray(discard) || discard.length !== 5) {
      console.warn('Invalid discard array');
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify({
          action: 'discardError',
          message: 'Must discard exactly 5 cards',
        }));
      }
      return;
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
    if (!hand || !hand.cards) {
      console.error(`Hand not found for player ${playerSeat}`);
      return;
    }

    // The player should have 18 cards (original 13 + 5 kitty) to be able to discard
    if (hand.cards.length !== 18) {
      console.warn(`Player ${playerSeat} has ${hand.cards.length} cards, expected 18`);
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify({
          action: 'discardError',
          message: 'Invalid hand size. Please wait for kitty cards.',
        }));
      }
      return;
    }

    // Validate that all discard cards are in the player's hand
    const handSet = new Set(hand.cards);
    const validDiscard = discard.every(card => handSet.has(card));

    if (!validDiscard) {
      console.warn('Discard contains cards not in player hand');
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify({
          action: 'discardError',
          message: 'Invalid cards selected for discard',
        }));
      }
      return;
    }

    // Validate trump suit
    const validSuits = ['Red', 'Green', 'Yellow', 'Black'];
    if (!validSuits.includes(trump)) {
      console.warn(`Invalid trump suit: ${trump}`);
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify({
          action: 'discardError',
          message: 'Invalid trump suit',
        }));
      }
      return;
    }

    // Remove discarded cards from hand (new hand should be 13 cards)
    const newHandCards = hand.cards.filter(card => !discard.includes(card));

    if (newHandCards.length !== 13) {
      console.error(`After discard, player should have 13 cards, but has ${newHandCards.length}`);
      return;
    }

    // Update player's hand in DynamoDB
    await docClient.send(new UpdateCommand({
      TableName: HANDS_TABLE,
      Key: {
        gameId,
        seat: playerSeat,
      },
      UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':cards': newHandCards,
        ':updatedAt': new Date().toISOString(),
      },
    }));

    // Update game state: set trump, status to PLAYING, currentPlayer to 1
    await docClient.send(new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
      UpdateExpression: `
        SET trump = :trump,
            #status = :status,
            currentPlayer = :currentPlayer,
            version = version + :one,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':trump': trump,
        ':status': GameStatus.PLAYING,
        ':currentPlayer': 1, // Player to the left of dealer (seat 0) leads
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
        ':currentVersion': game.version,
      },
      ConditionExpression: 'version = :currentVersion',
    }));

    console.log(`Player ${playerSeat} discarded 5 cards and chose ${trump} as trump`);

    // Broadcast trump chosen and play start to all players
    const localClient = global.localWebSocketClient;
    if (localClient) {
      await localClient.broadcastToGame(gameId, {
        action: 'trumpChosen',
        suit: trump,
      });

      await localClient.broadcastToGame(gameId, {
        action: 'playStart',
        leader: 1,
      });
    }

  } catch (error) {
    console.error('Error handling discard and trump:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('Concurrent update conflict, ignoring');
    } else {
      // Send error message back to player
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify({
          action: 'discardError',
          message: 'An error occurred processing your selection',
        }));
      }
    }
  }
}

/**
 * Handle playCard action
 */
async function handlePlayCard(connectionInfo, message) {
  const { gameId, seat: playerSeat } = connectionInfo;
  
  if (playerSeat === null || playerSeat === undefined) {
    console.error('Cannot handle playCard: player seat not set');
    return;
  }

  // Handle playing a card - delegate to gameAction handler
  console.log(`🎴 Processing playCard: player=${connectionInfo.playerName} (seat ${playerSeat}), card=${message.card}, game=${gameId}`);

  const { handler: gameAction } = require('../handlers/gameAction');

  try {
    const event = {
      body: JSON.stringify({
        gameId: gameId.toUpperCase(),
        playerName: connectionInfo.playerName,
        action: 'playCard',
        card: message.card,
      }),
    };

    const result = await gameAction(event);
    console.log(`✅ playCard result status: ${result?.statusCode}, body:`, result?.body);

    // Check if there was an error in the result
    if (result && result.statusCode && result.statusCode !== 200) {
      console.error(`❌ playCard failed with status ${result.statusCode}:`, result.body);
      // Send error message back to player
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        try {
          const errorBody = JSON.parse(result.body || '{}');
          conn.ws.send(JSON.stringify({
            action: 'cardError',
            message: errorBody.message || 'Failed to play card',
          }));
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
        }
      }
    } else if (result && result.statusCode === 200) {
      console.log(`✅ playCard succeeded - WebSocket broadcasts should have been sent`);
    } else {
      console.warn(`⚠️  Unexpected result format:`, result);
    }
  } catch (error) {
    console.error('❌ Exception handling playCard:', error);
    // Send error message back to player
    const conn = wsConnections.get(connectionInfo.connectionId);
    if (conn && conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify({
        action: 'cardError',
        message: error.message || 'An error occurred playing your card',
      }));
    }
  }
}

/**
 * Handle bidding actions (bid/pass)
 */
async function handleBiddingAction(connectionInfo, message) {
  const { gameId, seat: playerSeat } = connectionInfo;
  
  if (playerSeat === null || playerSeat === undefined) {
    console.error('Cannot handle bidding action: player seat not set');
    return;
  }

  try {
    // Get current game state
    const gameResult = await docClient.send(new GetCommand({
      TableName: GAMES_TABLE,
      Key: { gameId },
    }));

    const game = gameResult.Item;
    if (!game) {
      console.error(`Game ${gameId} not found`);
      return;
    }

    if (game.status !== GameStatus.BIDDING) {
      console.error(`Game ${gameId} is not in BIDDING status`);
      return;
    }

    // Initialize passed array if it doesn't exist
    const passed = game.passed || [];
    
    // Check if player has already passed
    if (passed.includes(playerSeat)) {
      console.warn(`Player ${playerSeat} already passed, ignoring action`);
      return;
    }

    // Verify it's this player's turn
    if (game.currentBidder !== playerSeat) {
      console.warn(`Not player ${playerSeat}'s turn (current bidder: ${game.currentBidder})`);
      return;
    }

    if (message.action === 'bid') {
      const amount = message.amount;
      const highBid = game.highBid || 0;
      
      // Validate bid amount
      let isValid = false;
      if (highBid === 0) {
        // First bid must be at least BID_MIN
        isValid = amount >= BID_MIN && amount % 5 === 0;
      } else {
        // Subsequent bids must be at least highBid + 5
        isValid = amount >= highBid + 5 && amount % 5 === 0;
      }

      if (!isValid) {
        console.warn(`Invalid bid amount: ${amount} (highBid: ${highBid})`);
        // Send error message back to player
        const conn = wsConnections.get(connectionInfo.connectionId);
        if (conn && conn.ws.readyState === 1) {
          conn.ws.send(JSON.stringify({
            action: 'bidError',
            message: `Invalid bid. Must be at least ${highBid === 0 ? BID_MIN : highBid + 5} and a multiple of 5.`,
          }));
        }
        return;
      }

      // Update game state
      const passedSet = new Set(passed);
      // Find next bidder (skip passed players)
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
          ExpressionAttributeNames: {
            '#status': 'status',
          },
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

        // Send kitty cards to the winner and update their hand in database
        if (game.kitty && Array.isArray(game.kitty) && game.kitty.length === 5) {
          // First, get the winner's current hand
          const handResult = await docClient.send(new GetCommand({
            TableName: HANDS_TABLE,
            Key: {
              gameId,
              seat: playerSeat,
            },
          }));

          const currentHand = handResult.Item;
          if (currentHand && currentHand.cards) {
            // Add kitty cards to the winner's hand
            const updatedHand = [...currentHand.cards, ...game.kitty];

            // Update the winner's hand in database
            await docClient.send(new UpdateCommand({
              TableName: HANDS_TABLE,
              Key: {
                gameId,
                seat: playerSeat,
              },
              UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
              ExpressionAttributeValues: {
                ':cards': updatedHand,
                ':updatedAt': new Date().toISOString(),
              },
            }));

            console.log(`Added ${game.kitty.length} kitty cards to winner seat ${playerSeat}'s hand (${updatedHand.length} total)`);
          }

          // Send kitty cards to the winner via WebSocket
          const localClient = global.localWebSocketClient;
          if (localClient) {
            await localClient.sendToPlayer(gameId, playerSeat, {
              action: 'kitty',
              cards: game.kitty,
            });
            console.log(`Sent kitty cards to winner seat ${playerSeat}`);
          }
        }

        // Broadcast bidding won
        const localClient = global.localWebSocketClient;
        if (localClient) {
          await localClient.broadcastToGame(gameId, {
            action: 'biddingWon',
            winner: playerSeat,
            amount: amount,
          });
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

        // Broadcast bid placed and next bidder
        const localClient = global.localWebSocketClient;
        if (localClient) {
          await localClient.broadcastToGame(gameId, {
            action: 'bidPlaced',
            seat: playerSeat,
            amount: amount,
          });
          await localClient.broadcastToGame(gameId, {
            action: 'nextBidder',
            seat: nextBidder,
          });
        }
      }
    } else if (message.action === 'pass') {
      // Add player to passed list
      const newPassed = [...passed, playerSeat];
      
      // Find next bidder (skip passed players)
      const passedSet = new Set(newPassed);
      let nextBidder = (playerSeat + 1) % 4;
      while (passedSet.has(nextBidder) && nextBidder !== playerSeat) {
        nextBidder = (nextBidder + 1) % 4;
      }

      // Check if only one player remains (bidding ends)
      if (newPassed.length === 3 || nextBidder === playerSeat) {
        // Find the one player who hasn't passed
        const remainingPlayer = [0, 1, 2, 3].find(seat => !passedSet.has(seat));
        const highBid = game.highBid || 0;
        const winningBid = highBid > 0 ? highBid : BID_MIN; // If no one bid, minimum goes to last player
        
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
          ExpressionAttributeNames: {
            '#status': 'status',
          },
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

        // Send kitty cards to the winner and update their hand in database
        if (game.kitty && Array.isArray(game.kitty) && game.kitty.length === 5) {
          // First, get the winner's current hand
          const handResult = await docClient.send(new GetCommand({
            TableName: HANDS_TABLE,
            Key: {
              gameId,
              seat: remainingPlayer,
            },
          }));

          const currentHand = handResult.Item;
          if (currentHand && currentHand.cards) {
            // Add kitty cards to the winner's hand
            const updatedHand = [...currentHand.cards, ...game.kitty];

            // Update the winner's hand in database
            await docClient.send(new UpdateCommand({
              TableName: HANDS_TABLE,
              Key: {
                gameId,
                seat: remainingPlayer,
              },
              UpdateExpression: 'SET cards = :cards, updatedAt = :updatedAt',
              ExpressionAttributeValues: {
                ':cards': updatedHand,
                ':updatedAt': new Date().toISOString(),
              },
            }));

            console.log(`Added ${game.kitty.length} kitty cards to winner seat ${remainingPlayer}'s hand (${updatedHand.length} total)`);
          }

          // Send kitty cards to the winner via WebSocket
          const localClient = global.localWebSocketClient;
          if (localClient) {
            await localClient.sendToPlayer(gameId, remainingPlayer, {
              action: 'kitty',
              cards: game.kitty,
            });
            console.log(`Sent kitty cards to winner seat ${remainingPlayer}`);
          }
        }

        // Broadcast bidding won
        const localClient = global.localWebSocketClient;
        if (localClient) {
          await localClient.broadcastToGame(gameId, {
            action: 'biddingWon',
            winner: remainingPlayer,
            amount: winningBid,
          });
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

        // Broadcast player passed and next bidder
        const localClient = global.localWebSocketClient;
        if (localClient) {
          await localClient.broadcastToGame(gameId, {
            action: 'playerPassed',
            seat: playerSeat,
          });
          await localClient.broadcastToGame(gameId, {
            action: 'nextBidder',
            seat: nextBidder,
          });
        }
      }
    }
  } catch (error) {
    console.error('Error handling bidding action:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('Concurrent update conflict, ignoring');
    } else {
      // Send error message back to player
      const conn = wsConnections.get(connectionInfo.connectionId);
      if (conn && conn.ws.readyState === 1) {
        conn.ws.send(JSON.stringify({
          action: 'bidError',
          message: 'An error occurred processing your bid/pass',
        }));
      }
    }
  }
}

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Wrap a Lambda handler to work with Express
 */
function wrapLambdaHandler(handler) {
  return async (req, res) => {
    try {
      // Create Lambda-style event object
      const event = {
        body: JSON.stringify(req.body),
        headers: req.headers,
        httpMethod: req.method,
        path: req.path,
        queryStringParameters: req.query,
      };

      // Call the Lambda handler
      const result = await handler(event);

      // Send the response
      res.status(result.statusCode);
      
      // Set headers from Lambda response
      if (result.headers) {
        Object.entries(result.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
      }

      // Parse and send body
      const body = typeof result.body === 'string' 
        ? JSON.parse(result.body) 
        : result.body;
      
      res.json(body);
    } catch (error) {
      console.error('Handler error:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };
}

// Routes
app.post('/createGame', wrapLambdaHandler(createGame));
app.post('/joinGame', wrapLambdaHandler(joinGame));
app.post('/choosePartner', wrapLambdaHandler(choosePartner));
app.post('/gameAction', wrapLambdaHandler(gameAction));
app.post('/startNextHand', wrapLambdaHandler(startNextHand));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List all games (debug endpoint)
app.get('/games', async (req, res) => {
  try {
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, GAMES_TABLE } = require('../shared/dynamodb');
    
    const result = await docClient.send(new ScanCommand({
      TableName: GAMES_TABLE,
    }));
    
    res.json({ games: result.Items || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket Server
const wss = new WebSocketServer({ 
  server,
  path: '/ws'
});

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const gameId = url.searchParams.get('gameId');
  const playerName = url.searchParams.get('playerName');
  const seat = url.searchParams.get('seat');

  if (!gameId || !playerName) {
    console.error('WebSocket connection missing required params');
    ws.close(1008, 'Missing gameId or playerName');
    return;
  }

  // Generate a connection ID
  const connectionId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const seatNumber = seat !== undefined && seat !== null ? parseInt(seat, 10) : null;
  
  // Store connection info
  const connectionInfo = {
    ws,
    gameId: gameId.toUpperCase(),
    playerName: decodeURIComponent(playerName),
    seat: seatNumber,
    connectionId,
  };
  
  wsConnections.set(connectionId, connectionInfo);
  
  // Also store in DynamoDB for compatibility with existing code
  try {
    await docClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        gameId: gameId.toUpperCase(),
        connectionId,
        playerName: decodeURIComponent(playerName),
        seat: seatNumber,
        connectedAt: new Date().toISOString(),
      },
    }));
  } catch (error) {
    console.error('Error storing connection in DynamoDB:', error);
  }

  console.log(`WebSocket connected: ${playerName} to game ${gameId} (connectionId: ${connectionId})`);

  // If game is already in BIDDING or PLAYING, send the player's hand
  (async () => {
    try {
      const normalizedGameId = gameId.toUpperCase();
      
      // Get game state
      const gameResult = await docClient.send(new GetCommand({
        TableName: GAMES_TABLE,
        Key: { gameId: normalizedGameId },
      }));
      
      const game = gameResult.Item;
      
      if (game && (game.status === GameStatus.BIDDING || game.status === GameStatus.PLAYING || game.status === GameStatus.TRUMP_SELECTION)) {
        // Game is in progress, fetch and send the player's hand
        if (seatNumber !== null && seatNumber !== undefined) {
          const handResult = await docClient.send(new GetCommand({
            TableName: HANDS_TABLE,
            Key: {
              gameId: normalizedGameId,
              seat: seatNumber,
            },
          }));
          
          const hand = handResult.Item;
          
          if (hand && hand.cards) {
            // Send the hand to the player
            ws.send(JSON.stringify({
              action: 'deal',
              cards: hand.cards,
            }));
            console.log(`Sent hand to reconnecting player ${playerName} (seat ${seatNumber}): ${hand.cards.length} cards`);
          }
          
          // If in BIDDING status, also send bidding state
          if (game.status === GameStatus.BIDDING) {
            ws.send(JSON.stringify({
              action: 'biddingStart',
              startingPlayer: game.currentBidder !== undefined ? game.currentBidder : 0,
              currentBid: game.currentBid || 50,
              minBid: 50,
            }));
            console.log(`Sent bidding state to reconnecting player ${playerName}`);
          }

          // If in TRUMP_SELECTION status, send trump selection state
          if (game.status === GameStatus.TRUMP_SELECTION) {
            // Send bidding won message to inform who won
            ws.send(JSON.stringify({
              action: 'biddingWon',
              winner: game.bidWinner,
              amount: game.winningBid,
            }));

            // If this player is the winner AND they don't already have the kitty cards (check if hand has < 18 cards),
            // send them the kitty cards
            if (seatNumber === game.bidWinner && game.kitty && Array.isArray(game.kitty) && hand.cards.length < 18) {
              ws.send(JSON.stringify({
                action: 'kitty',
                cards: game.kitty,
              }));
              console.log(`Sent kitty cards to reconnecting winner ${playerName} (seat ${seatNumber})`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending hand to reconnecting player:', error);
      // Don't fail the connection if we can't send the hand
    }
  })();

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('WebSocket message received:', data);
      
      // Handle bid/pass messages
      if (data.action === 'bid' || data.action === 'pass') {
        await handleBiddingAction(connectionInfo, data);
      }

      // Handle discard and trump selection
      if (data.action === 'discardAndTrump') {
        await handleDiscardAndTrump(connectionInfo, data);
      }

      // Handle playCard action
      if (data.action === 'playCard') {
        await handlePlayCard(connectionInfo, data);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });
  
  // Store connection info with reference to ws for later updates
  connectionInfo.ws = ws;

  ws.on('close', async () => {
    console.log(`WebSocket disconnected: ${playerName} from game ${gameId}`);
    wsConnections.delete(connectionId);
    
    // Remove from DynamoDB
    try {
      await docClient.send(new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: {
          gameId: gameId.toUpperCase(),
          connectionId,
        },
      }));
    } catch (error) {
      console.error('Error removing connection from DynamoDB:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Local WebSocket client for sending messages
class LocalWebSocketClient {
  constructor() {
    this.connections = wsConnections;
  }

  async sendToConnection(connectionId, message) {
    const conn = this.connections.get(connectionId);
    if (conn && conn.ws.readyState === 1) { // WebSocket.OPEN
      conn.ws.send(JSON.stringify(message));
      console.log(`Sent message to connection ${connectionId}:`, message);
      return true;
    } else {
      console.warn(`Connection ${connectionId} not found or not open`);
      return false;
    }
  }

  async getGameConnections(gameId) {
    const connections = [];
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.gameId === gameId.toUpperCase()) {
        connections.push({
          connectionId: conn.connectionId,
          gameId: conn.gameId,
          playerName: conn.playerName,
          seat: conn.seat,
        });
      }
    }
    return connections;
  }

  async sendToPlayer(gameId, seat, message) {
    const connections = await this.getGameConnections(gameId);
    const playerConnection = connections.find(conn => conn.seat === seat);
    
    if (playerConnection) {
      return await this.sendToConnection(playerConnection.connectionId, message);
    } else {
      console.warn(`No connection found for seat ${seat} in game ${gameId}`);
      return false;
    }
  }

  async broadcastToGame(gameId, message) {
    const normalizedGameId = gameId.toUpperCase();
    const connections = await this.getGameConnections(normalizedGameId);
    console.log(`📢 Broadcasting to ${connections.length} connections in game ${normalizedGameId}:`, message);
    
    if (connections.length === 0) {
      console.warn(`⚠️  No connections found for game ${normalizedGameId}`);
      // Log all current connections for debugging
      console.log(`Current connections:`, Array.from(this.connections.entries()).map(([id, conn]) => ({
        id,
        gameId: conn.gameId,
        playerName: conn.playerName,
        seat: conn.seat
      })));
    }
    
    const results = await Promise.allSettled(
      connections.map(conn => 
        this.sendToConnection(conn.connectionId, message)
      )
    );
    
    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`❌ Failed to send to connection ${connections[index]?.connectionId}:`, result.reason);
      }
    });
    
    return results;
  }
}

// Export the WebSocket client for use in handlers
global.localWebSocketClient = new LocalWebSocketClient();

// Start server
server.listen(PORT, () => {
  console.log(`
🎮 Rook Backend - Local Development Server
==========================================
HTTP Server:  http://localhost:${PORT}
WebSocket:    ws://localhost:${PORT}/ws

Endpoints:
  POST /createGame     - Create a new game
  POST /joinGame       - Join an existing game
  POST /choosePartner  - Host selects partner (when game is full)
  POST /gameAction     - Handle game actions (play cards, etc.)
  GET  /games          - List all games (debug)
  GET  /health         - Health check

WebSocket:
  Connect: ws://localhost:${PORT}/ws?gameId=ABC123&playerName=Alice&seat=0

Environment:
  GAMES_TABLE: ${process.env.GAMES_TABLE || 'RookGames'}
  DynamoDB:    ${process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000'}

Make sure DynamoDB Local is running!
  `);
});
