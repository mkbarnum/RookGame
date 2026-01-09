/**
 * Local Development Server
 * 
 * Simulates API Gateway by exposing Lambda handlers as HTTP endpoints.
 * Uses DynamoDB Local for database.
 * 
 * Usage: node local/server.js
 */

const express = require('express');
const cors = require('cors');
const { handler: createGame } = require('../handlers/createGame');
const { handler: joinGame } = require('../handlers/joinGame');
const { handler: choosePartner } = require('../handlers/choosePartner');

const app = express();
const PORT = process.env.PORT || 3001;

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

// Start server
app.listen(PORT, () => {
  console.log(`
🎮 Rook Backend - Local Development Server
==========================================
Server running at: http://localhost:${PORT}

Endpoints:
  POST /createGame     - Create a new game
  POST /joinGame       - Join an existing game
  POST /choosePartner  - Host selects partner (when game is full)
  GET  /games          - List all games (debug)
  GET  /health         - Health check

Environment:
  GAMES_TABLE: ${process.env.GAMES_TABLE || 'RookGames'}
  DynamoDB:    ${process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000'}

Make sure DynamoDB Local is running!
  `);
});
