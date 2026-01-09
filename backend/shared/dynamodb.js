/**
 * Shared DynamoDB client configuration
 * 
 * Tables:
 * - RookGames: Main game state (gameId PK)
 * - RookHands: Player hands/cards (gameId PK, seat SK)
 * - RookConnections: WebSocket connections (gameId PK, connectionId SK, GSI on connectionId)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// DynamoDB endpoint - use local endpoint for development
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT;

// Create DynamoDB client with optional local endpoint
const clientConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
};

// If local endpoint is specified, configure for local development
if (DYNAMODB_ENDPOINT) {
  clientConfig.endpoint = DYNAMODB_ENDPOINT;
  clientConfig.credentials = {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  };
  // Fix for AWS SDK v3 hanging with DynamoDB Local
  clientConfig.requestChecksumCalculation = 'WHEN_REQUIRED';
  clientConfig.responseChecksumValidation = 'WHEN_REQUIRED';
}

const client = new DynamoDBClient(clientConfig);

// Create DocumentClient for easier JSON handling
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// Table names from environment variables
const GAMES_TABLE = process.env.GAMES_TABLE || 'RookGames';
const HANDS_TABLE = process.env.HANDS_TABLE || 'RookHands';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'RookConnections';

// GSI name for looking up connections by connectionId
const CONNECTION_ID_INDEX = 'ConnectionIdIndex';

module.exports = {
  client,
  docClient,
  GAMES_TABLE,
  HANDS_TABLE,
  CONNECTIONS_TABLE,
  CONNECTION_ID_INDEX,
};
