# Rook Backend

AWS Lambda backend for the Rook card game.

## Project Structure

```
backend/
├── handlers/           # Lambda function handlers
│   ├── createGame.js   # POST /createGame - Create a new game lobby
│   └── joinGame.js     # POST /joinGame - Join an existing game
├── shared/             # Shared utilities
│   ├── dynamodb.js     # DynamoDB client configuration
│   └── gameUtils.js    # Game utilities (code generation, state helpers)
├── local/              # Local development server
│   ├── server.js       # Express server wrapping Lambda handlers
│   └── setup-local-db.js # Script to create DynamoDB tables locally
├── docker-compose.yml  # DynamoDB Local container
├── api-tests.http      # REST Client test file for VS Code
├── index.js            # Main export file
├── package.json        # Node.js dependencies
└── README.md           # This file
```

## Local Development Setup

### Prerequisites

- **Node.js 18+** (v20 recommended) - AWS SDK v3 requires modern Node.js
- **Docker** - For running DynamoDB Local
- **npm** - Package manager

> ⚠️ **Node.js Version**: If you're using nvm and have an older default version, use:
> ```bash
> nvm use 20
> ```

### Quick Start (One Command)

From the project root:

```bash
./start-local.sh
```

Or manually:

```bash
# 1. Start DynamoDB Local
cd backend
docker-compose up -d

# 2. Install dependencies (if not done)
npm install

# 3. Setup the database table
DYNAMODB_ENDPOINT=http://localhost:8000 node local/setup-local-db.js

# 4. Start the server
DYNAMODB_ENDPOINT=http://localhost:8000 node local/server.js
```

### Step-by-Step Setup

#### 1. Start DynamoDB Local

```bash
cd backend
docker-compose up -d
```

This starts DynamoDB Local on `http://localhost:8000` in **in-memory mode** (data is cleared on restart).

To check if it's running:
```bash
docker ps
# Should show: rook-dynamodb ... Up ...
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Create the Database Table

```bash
DYNAMODB_ENDPOINT=http://localhost:8000 node local/setup-local-db.js
```

Expected output:
```
🗄️  Setting up Local DynamoDB Tables
====================================
Endpoint: http://localhost:8000

Checking if table "RookGames" exists...
Creating table "RookGames"...
✓ Created table "RookGames"

✅ Local database setup complete!
```

#### 4. Start the Local Server

```bash
DYNAMODB_ENDPOINT=http://localhost:8000 node local/server.js
```

The server runs on `http://localhost:3001`:

```
🎮 Rook Backend - Local Development Server
==========================================
Server running at: http://localhost:3001

Endpoints:
  POST /createGame  - Create a new game
  POST /joinGame    - Join an existing game
  GET  /games       - List all games (debug)
  GET  /health      - Health check
```

### Testing the API

#### Using curl

```bash
# Health check
curl http://localhost:3001/health

# Create a game
curl -X POST http://localhost:3001/createGame \
  -H "Content-Type: application/json" \
  -d '{"hostName": "Alice"}'

# Join a game (replace GAMEID with actual game ID)
curl -X POST http://localhost:3001/joinGame \
  -H "Content-Type: application/json" \
  -d '{"gameId": "GAMEID", "playerName": "Bob"}'

# List all games
curl http://localhost:3001/games
```

#### Using VS Code REST Client

1. Install the **REST Client** extension (by Huachao Mao)
2. Open `backend/api-tests.http`
3. Click "Send Request" above each request to test

### Troubleshooting

#### AWS SDK Hanging / Timeout

If the setup script or server hangs, it's likely due to AWS SDK v3 checksum validation issues with DynamoDB Local. The codebase includes fixes for this, but ensure you're using Node.js 18+.

#### DynamoDB Local SQLite Errors

If you see SQLite errors in Docker logs:
```
com.almworks.sqlite4java.SQLiteException: [14] unable to open database file
```

The docker-compose is configured to use in-memory mode to avoid this. If you need persistent data, you may need to fix volume permissions.

#### Port Already in Use

```bash
# Check what's using port 3001
lsof -i :3001

# Check what's using port 8000
lsof -i :8000
```

#### Docker Container Issues

```bash
# View logs
docker logs rook-dynamodb

# Restart container
docker-compose down && docker-compose up -d

# Full reset
docker-compose down
docker volume rm backend_dynamodb-data 2>/dev/null
docker-compose up -d
```

---

## Lambda Functions

### createGame

Creates a new game lobby.

**HTTP API:** `POST /createGame`

**Request Body:**
```json
{
  "hostName": "PlayerName"
}
```

**Response (201):**
```json
{
  "success": true,
  "gameId": "ABCDEF",
  "seat": 0,
  "game": {
    "gameId": "ABCDEF",
    "hostName": "PlayerName",
    "players": [{ "seat": 0, "name": "PlayerName" }],
    "status": "LOBBY",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### joinGame

Join an existing game lobby.

**HTTP API:** `POST /joinGame`

**Request Body:**
```json
{
  "gameId": "ABCDEF",
  "playerName": "AnotherPlayer"
}
```

**Response (200):**
```json
{
  "success": true,
  "gameId": "ABCDEF",
  "seat": 1,
  "players": [
    { "seat": 0, "name": "Host" },
    { "seat": 1, "name": "AnotherPlayer" }
  ],
  "status": "LOBBY",
  "hostName": "Host"
}
```

**Error Responses:**
- `400` - Invalid input, game full, or name already taken
- `404` - Game not found
- `409` - Concurrent join conflict (retry)

---

## DynamoDB Schema

### Games Table

**Table Name:** `RookGames` (configurable via `GAMES_TABLE` env var)

**Partition Key:** `gameId` (String)

**Attributes:**
| Field | Type | Description |
|-------|------|-------------|
| `gameId` | String | 6-character uppercase game code |
| `hostName` | String | Name of the game creator |
| `players` | List | Array of `{ seat: number, name: string }` |
| `status` | String | `LOBBY`, `FULL`, `BIDDING`, `PLAYING`, `FINISHED` |
| `scores` | Map | `{ team0: number, team1: number }` |
| `version` | Number | Optimistic locking version |
| `createdAt` | String | ISO timestamp |
| `updatedAt` | String | ISO timestamp |
| `currentRound` | Number | Current round number |
| `trumpColor` | String | Current trump color (null until set) |
| `currentBid` | Number | Current bid (null until set) |
| `biddingWinner` | Number | Seat of bidding winner |
| `currentTrick` | List | Cards played in current trick |
| `tricksWon` | Map | `{ team0: number, team1: number }` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GAMES_TABLE` | `RookGames` | DynamoDB table name |
| `AWS_REGION` | `us-east-1` | AWS region |
| `DYNAMODB_ENDPOINT` | (none) | Local DynamoDB endpoint (set for local dev) |
| `PORT` | `3001` | Local server port |

---

## Deployment

These Lambda functions are designed to be deployed with:
- AWS SAM (Serverless Application Model)
- AWS CDK
- Serverless Framework
- Direct Lambda deployment

Ensure the DynamoDB table is created before deploying the functions.
