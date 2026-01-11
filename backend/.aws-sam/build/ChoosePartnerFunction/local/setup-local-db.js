/**
 * Setup Local DynamoDB Tables
 * 
 * Creates the required tables in DynamoDB Local:
 * - RookGames: Main game state
 * - RookHands: Player hands/cards
 * - RookConnections: WebSocket connections with GSI
 * 
 * Run this once after starting DynamoDB Local.
 * 
 * Usage: DYNAMODB_ENDPOINT=http://localhost:8000 node local/setup-local-db.js
 */

const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';

// Table names
const GAMES_TABLE = process.env.GAMES_TABLE || 'RookGames';
const HANDS_TABLE = process.env.HANDS_TABLE || 'RookHands';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'RookConnections';

const client = new DynamoDBClient({
  region: 'local',
  endpoint: DYNAMODB_ENDPOINT,
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
  // Fix for AWS SDK v3 hanging with DynamoDB Local
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

async function tableExists(tableName) {
  try {
    const result = await client.send(new ListTablesCommand({}));
    return result.TableNames?.includes(tableName) || false;
  } catch (error) {
    return false;
  }
}

/**
 * Create the Games table
 * PK: gameId (String)
 */
async function createGamesTable() {
  console.log(`Checking if table "${GAMES_TABLE}" exists...`);
  
  const params = {
    TableName: GAMES_TABLE,
    KeySchema: [
      { AttributeName: 'gameId', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'gameId', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  };

  try {
    const exists = await tableExists(GAMES_TABLE);
    
    if (exists) {
      console.log(`✓ Table "${GAMES_TABLE}" already exists`);
      return;
    }

    console.log(`Creating table "${GAMES_TABLE}"...`);
    await client.send(new CreateTableCommand(params));
    console.log(`✓ Created table "${GAMES_TABLE}"`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`✓ Table "${GAMES_TABLE}" already exists`);
    } else {
      throw error;
    }
  }
}

/**
 * Create the Hands table
 * PK: gameId (String)
 * SK: seat (Number)
 */
async function createHandsTable() {
  console.log(`Checking if table "${HANDS_TABLE}" exists...`);
  
  const params = {
    TableName: HANDS_TABLE,
    KeySchema: [
      { AttributeName: 'gameId', KeyType: 'HASH' },
      { AttributeName: 'seat', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'gameId', AttributeType: 'S' },
      { AttributeName: 'seat', AttributeType: 'N' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  };

  try {
    const exists = await tableExists(HANDS_TABLE);
    
    if (exists) {
      console.log(`✓ Table "${HANDS_TABLE}" already exists`);
      return;
    }

    console.log(`Creating table "${HANDS_TABLE}"...`);
    await client.send(new CreateTableCommand(params));
    console.log(`✓ Created table "${HANDS_TABLE}"`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`✓ Table "${HANDS_TABLE}" already exists`);
    } else {
      throw error;
    }
  }
}

/**
 * Create the Connections table
 * PK: gameId (String)
 * SK: connectionId (String)
 * GSI: ConnectionIdIndex on connectionId (for disconnect lookups)
 */
async function createConnectionsTable() {
  console.log(`Checking if table "${CONNECTIONS_TABLE}" exists...`);
  
  const params = {
    TableName: CONNECTIONS_TABLE,
    KeySchema: [
      { AttributeName: 'gameId', KeyType: 'HASH' },
      { AttributeName: 'connectionId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'gameId', AttributeType: 'S' },
      { AttributeName: 'connectionId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'ConnectionIdIndex',
        KeySchema: [
          { AttributeName: 'connectionId', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  };

  try {
    const exists = await tableExists(CONNECTIONS_TABLE);
    
    if (exists) {
      console.log(`✓ Table "${CONNECTIONS_TABLE}" already exists`);
      return;
    }

    console.log(`Creating table "${CONNECTIONS_TABLE}" with GSI "ConnectionIdIndex"...`);
    await client.send(new CreateTableCommand(params));
    console.log(`✓ Created table "${CONNECTIONS_TABLE}"`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`✓ Table "${CONNECTIONS_TABLE}" already exists`);
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log(`
🗄️  Setting up Local DynamoDB Tables
====================================
Endpoint: ${DYNAMODB_ENDPOINT}
  `);

  // Add timeout to prevent hanging
  const timeout = setTimeout(() => {
    console.error('\n❌ Setup timed out after 30 seconds');
    process.exit(1);
  }, 30000);

  try {
    // Create all tables
    await createGamesTable();
    await createHandsTable();
    await createConnectionsTable();
    
    clearTimeout(timeout);
    console.log(`
✅ Local database setup complete!

Tables created:
  - ${GAMES_TABLE} (PK: gameId)
  - ${HANDS_TABLE} (PK: gameId, SK: seat)
  - ${CONNECTIONS_TABLE} (PK: gameId, SK: connectionId, GSI: ConnectionIdIndex)
`);
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error('\n❌ Setup failed:', error.message);
    console.log(`
Make sure DynamoDB Local is running:
  docker-compose up -d
    `);
    process.exit(1);
  }
}

main();
