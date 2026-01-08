# Rook Online - Multiplayer Card Game

A real-time, 4-player multiplayer Rook card game built with React, TypeScript, and AWS serverless technologies. Play the classic trick-taking card game with friends from anywhere!

![Rook Online](https://img.shields.io/badge/status-in%20development-yellow)
![React](https://img.shields.io/badge/React-19.x-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-4.9-blue)
![AWS](https://img.shields.io/badge/AWS-Serverless-orange)

## 📋 Table of Contents

- [Game Overview](#-game-overview)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Development Setup](#-development-setup)
- [Deployment](#-deployment)
- [API Reference](#-api-reference)
- [Game Rules Summary](#-game-rules-summary)

## 🎮 Game Overview

Rook is a classic trick-taking card game played by 4 players in 2 teams. This implementation features:

- **Real-time multiplayer** via WebSocket connections
- **Mobile-first PWA** - installable on any device
- **Custom game rooms** with shareable game codes
- **Host partner selection** - host chooses their teammate
- **Full game logic** - bidding, trump selection, trick-taking, and scoring

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React PWA)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  LobbyPage  │  │  GamePage   │  │  WebSocket  │  │  Service Worker     │ │
│  │  - Create   │  │  - Cards    │  │  Client     │  │  (Offline Support)  │ │
│  │  - Join     │  │  - Bidding  │  │             │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                │                              │
                │ REST API                     │ WebSocket
                ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AWS API GATEWAY                                   │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐   │
│  │     HTTP API (REST)         │  │     WebSocket API                   │   │
│  │  POST /createGame           │  │  $connect    - Player connects      │   │
│  │  POST /joinGame             │  │  $disconnect - Player disconnects   │   │
│  └─────────────────────────────┘  │  $default    - Game actions         │   │
│                                   └─────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                │                              │
                ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AWS LAMBDA FUNCTIONS                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ createGame  │  │  joinGame   │  │  connect    │  │    gameAction       │ │
│  │             │  │             │  │  disconnect │  │  - choosePartner    │ │
│  │             │  │             │  │             │  │  - bid / pass       │ │
│  │             │  │             │  │             │  │  - selectTrump      │ │
│  │             │  │             │  │             │  │  - discardKitty     │ │
│  │             │  │             │  │             │  │  - playCard         │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                │                              │
                ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DYNAMODB TABLES                                │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │       Games         │  │       Hands         │  │    Connections      │  │
│  │  PK: gameId         │  │  PK: gameId         │  │  PK: gameId         │  │
│  │  - players[]        │  │  SK: seat           │  │  SK: connectionId   │  │
│  │  - status           │  │  - cards[]          │  │  - playerSeat       │  │
│  │  - scores           │  │                     │  │  - playerName       │  │
│  │  - trump, bid, etc. │  │                     │  │                     │  │
│  │  - version (lock)   │  │                     │  │                     │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Game Creation**: Player creates game via REST API → Lambda generates game code → Stored in DynamoDB
2. **Game Joining**: Players join with code via REST API → Lambda adds player to game → Updates DynamoDB
3. **Real-time Play**: All game actions (bids, plays, etc.) flow through WebSocket → Lambda processes → Broadcasts to all players

## 🛠 Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| **React 19** | UI framework |
| **TypeScript** | Type safety |
| **React Router 6** | Client-side routing |
| **WebSocket API** | Real-time communication |
| **Workbox** | PWA service worker |
| **CSS3** | Mobile-first responsive styling |

### Backend
| Technology | Purpose |
|------------|---------|
| **AWS Lambda** | Serverless compute (Node.js 18) |
| **API Gateway** | HTTP API + WebSocket API |
| **DynamoDB** | NoSQL database with optimistic locking |
| **AWS SAM/CloudFormation** | Infrastructure as code |

### Development Tools
| Tool | Purpose |
|------|---------|
| **Create React App** | Frontend scaffolding |
| **AWS CLI / SAM CLI** | Deployment and local testing |
| **wscat** | WebSocket testing |

## 📁 Project Structure

```
rook/
├── README.md                 # This file
├── rook_rules.txt           # Detailed game rules
├── prompts.txt              # Development prompts/guide
│
├── frontend/                # React PWA application
│   ├── public/
│   │   ├── index.html       # PWA-enabled HTML
│   │   └── manifest.json    # PWA manifest
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LobbyPage.tsx    # Home/lobby UI
│   │   │   ├── LobbyPage.css
│   │   │   ├── GamePage.tsx     # Game table UI
│   │   │   └── GamePage.css
│   │   ├── hooks/               # Custom React hooks (future)
│   │   │   └── useWebSocket.ts  # WebSocket connection hook
│   │   ├── context/             # React contexts (future)
│   │   │   └── GameContext.tsx  # Game state management
│   │   ├── components/          # Reusable components (future)
│   │   │   ├── Card.tsx
│   │   │   ├── Hand.tsx
│   │   │   └── PlayerArea.tsx
│   │   ├── App.tsx          # Router setup
│   │   ├── App.css
│   │   ├── index.tsx        # Entry point + SW registration
│   │   ├── index.css
│   │   └── serviceWorkerRegistration.ts
│   ├── package.json
│   └── tsconfig.json
│
└── backend/                 # AWS Lambda functions (to be created)
    ├── src/
    │   ├── handlers/
    │   │   ├── createGame.ts    # POST /createGame
    │   │   ├── joinGame.ts      # POST /joinGame
    │   │   ├── connect.ts       # WebSocket $connect
    │   │   ├── disconnect.ts    # WebSocket $disconnect
    │   │   └── gameAction.ts    # WebSocket $default (all game actions)
    │   ├── lib/
    │   │   ├── db.ts            # DynamoDB client & helpers
    │   │   ├── broadcast.ts     # WebSocket broadcast utility
    │   │   └── gameLogic.ts     # Card/trick/scoring logic
    │   └── types/
    │       └── game.ts          # TypeScript interfaces
    ├── template.yaml            # AWS SAM template
    └── package.json
```

## 💻 Development Setup

### Prerequisites

- **Node.js 18+** and npm
- **AWS Account** with configured credentials
- **AWS CLI** installed and configured
- **AWS SAM CLI** (optional, for local Lambda testing)

### Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build
```

The frontend will be available at `http://localhost:3000`

### Backend Setup (Coming Soon)

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Run local tests
npm test

# Deploy to AWS (requires configured AWS credentials)
sam build
sam deploy --guided
```

### Environment Variables

Create a `.env` file in the frontend directory:

```env
# API Configuration (update after backend deployment)
REACT_APP_API_BASE_URL=https://your-api-gateway-url.amazonaws.com
REACT_APP_WS_BASE_URL=wss://your-websocket-api-url.amazonaws.com/prod
```

### Local Testing with wscat

```bash
# Install wscat globally
npm install -g wscat

# Connect to WebSocket (after deployment)
wscat -c "wss://YOUR_WS_API_URL/prod?gameId=ABC123&playerName=TestPlayer"
```

## 🚀 Deployment

### Infrastructure (AWS SAM)

The backend uses AWS SAM for deployment. Key resources:

```yaml
# DynamoDB Tables
- Games (PK: gameId)
- Hands (PK: gameId, SK: seat)  
- Connections (PK: gameId, SK: connectionId, GSI on connectionId)

# API Gateway
- HTTP API for REST endpoints
- WebSocket API for real-time game communication

# Lambda Functions
- createGame, joinGame (HTTP triggers)
- connect, disconnect, gameAction (WebSocket triggers)
```

### Deployment Steps

```bash
# 1. Build the SAM application
cd backend
sam build

# 2. Deploy (first time - will prompt for parameters)
sam deploy --guided

# 3. Subsequent deployments
sam deploy

# 4. Update frontend with API URLs from deployment output
# Update .env with REACT_APP_API_BASE_URL and REACT_APP_WS_BASE_URL

# 5. Build and deploy frontend (e.g., to S3 + CloudFront)
cd ../frontend
npm run build
aws s3 sync build/ s3://your-bucket-name
```

## 📡 API Reference

### REST Endpoints

#### POST `/createGame`
Create a new game lobby.

**Request:**
```json
{
  "playerName": "Alice"
}
```

**Response:**
```json
{
  "gameId": "ABC123",
  "seat": 0,
  "players": [{ "seat": 0, "name": "Alice" }]
}
```

#### POST `/joinGame`
Join an existing game.

**Request:**
```json
{
  "gameId": "ABC123",
  "playerName": "Bob"
}
```

**Response:**
```json
{
  "seat": 1,
  "players": [
    { "seat": 0, "name": "Alice" },
    { "seat": 1, "name": "Bob" }
  ]
}
```

### WebSocket Actions

Connect with: `wss://API_URL/prod?gameId=ABC123&playerName=Alice&seat=0`

#### Client → Server Messages

| Action | Payload | Description |
|--------|---------|-------------|
| `choosePartner` | `{ seat: 2 }` | Host selects partner (host only) |
| `bid` | `{ amount: 55 }` | Place a bid |
| `pass` | `{}` | Pass on bidding |
| `selectTrump` | `{ suit: "Green" }` | Select trump suit (bid winner only) |
| `discardKitty` | `{ cards: ["Green5", "Black10"] }` | Discard cards to kitty |
| `playCard` | `{ card: "Green14" }` | Play a card |

#### Server → Client Messages

| Action | Description |
|--------|-------------|
| `playerJoined` | New player joined the game |
| `partnerSelected` | Teams have been assigned |
| `gameStarted` | Cards dealt, bidding begins |
| `bidPlaced` | A player placed a bid |
| `bidPassed` | A player passed |
| `bidWon` | Bidding complete, winner announced |
| `trumpSelected` | Trump suit chosen |
| `kittyDiscarded` | Kitty cards discarded, play begins |
| `cardPlayed` | A card was played |
| `trickWon` | Trick complete, winner announced |
| `handComplete` | Hand finished, scores updated |
| `gameOver` | Game finished, winner announced |

## 🃏 Game Rules Summary

This implementation follows **Kentucky Rook** variant rules:

### Deck
- 57 cards: 1-14 in four suits (Red, Green, Yellow, Black) + Rook bird card
- **1 is HIGH** (ranks above 14)
- **Rook is LOWEST trump** (must follow suit)

### Teams
- 4 players, 2 teams of 2
- Host (seat 0) chooses their partner after all players join
- Partners sit opposite each other

### Bidding
- Minimum bid: **50 points**
- Increments of **5 points**
- Host starts bidding, proceeds clockwise
- Once you pass, you're out
- Winner gets the **5-card kitty** (nest)

### Play
- Bid winner selects trump suit
- Bid winner discards 5 cards to kitty (keeps kitty points)
- Player left of dealer leads first trick
- **Must follow suit** if able (Rook counts as trump suit)
- Highest card of led suit wins (unless trumped)
- Trick winner leads next

### Scoring
| Card | Points |
|------|--------|
| 5s | 5 points |
| 10s | 10 points |
| 14s | 10 points |
| 1s | 15 points |
| Rook | 20 points |
| **Total** | **180 points** |

- **Make bid**: Score all points captured
- **Set (fail bid)**: Lose bid amount, score 0
- **Sweep all tricks**: Automatic **200 points**
- **Win condition**: First team to **200+ total points**

---

## 📄 License

MIT License - feel free to use and modify!

## 🤝 Contributing

Contributions welcome! Please read the game rules in `rook_rules.txt` before implementing game logic.

---

Built with ❤️ for Rook enthusiasts everywhere
