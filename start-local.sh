#!/bin/bash

# Rook Local Development Launcher
# Starts DynamoDB Local, backend server, and frontend

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║               🎮 ROOK LOCAL DEVELOPMENT                    ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker daemon is not running. Please start Docker.${NC}"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 18+.${NC}"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${YELLOW}⚠️  Node.js version is $(node -v). Recommended: v18+${NC}"
    echo -e "${YELLOW}   Run 'nvm use 20' if you have nvm installed.${NC}"
    
    # Try to use Node 20 if available via nvm
    if [ -d "$HOME/.nvm/versions/node/v20.19.1" ]; then
        echo -e "${GREEN}   Found Node v20 via nvm, using it...${NC}"
        export PATH="$HOME/.nvm/versions/node/v20.19.1/bin:$PATH"
    fi
fi

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down...${NC}"
    
    # Kill background processes
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    # Stop Docker container
    echo -e "${BLUE}Stopping DynamoDB Local...${NC}"
    cd "$BACKEND_DIR" && docker-compose down 2>/dev/null || true
    
    echo -e "${GREEN}✅ Shutdown complete${NC}"
    exit 0
}

# Set up trap for cleanup
trap cleanup SIGINT SIGTERM

# Step 1: Start DynamoDB Local
echo -e "${BLUE}[1/5] Starting DynamoDB Local...${NC}"
cd "$BACKEND_DIR"
docker-compose up -d

# Wait for DynamoDB to be ready
echo -e "${BLUE}      Waiting for DynamoDB to be ready...${NC}"
sleep 2

# Check if DynamoDB is responding
for i in {1..10}; do
    if curl -s http://localhost:8000 > /dev/null 2>&1; then
        echo -e "${GREEN}      ✓ DynamoDB Local is running${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}❌ DynamoDB Local failed to start${NC}"
        docker logs rook-dynamodb
        exit 1
    fi
    sleep 1
done

# Step 2: Install backend dependencies
echo -e "${BLUE}[2/5] Installing backend dependencies...${NC}"
cd "$BACKEND_DIR"
if [ ! -d "node_modules" ]; then
    npm install
else
    echo -e "${GREEN}      ✓ Dependencies already installed${NC}"
fi

# Step 3: Setup database tables
echo -e "${BLUE}[3/5] Setting up database tables...${NC}"
cd "$BACKEND_DIR"
DYNAMODB_ENDPOINT=http://localhost:8000 node local/setup-local-db.js || {
    echo -e "${YELLOW}      ⚠ Table may already exist (this is OK)${NC}"
}

# Step 4: Start backend server
echo -e "${BLUE}[4/5] Starting backend server...${NC}"
cd "$BACKEND_DIR"
DYNAMODB_ENDPOINT=http://localhost:8000 node local/server.js &
BACKEND_PID=$!
sleep 2

# Verify backend is running
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}      ✓ Backend running at http://localhost:3001${NC}"
else
    echo -e "${RED}❌ Backend failed to start${NC}"
    exit 1
fi

# Step 5: Install frontend dependencies and start
echo -e "${BLUE}[5/6] Starting frontend...${NC}"
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    npm install
fi

# Start frontend in background
echo -e "${BLUE}Starting frontend dev server...${NC}"
cd "$FRONTEND_DIR"
BROWSER=none npm start > /dev/null 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to be ready
echo -e "${BLUE}Waiting for frontend to be ready...${NC}"
sleep 8

# Check if frontend is responding
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}      ✓ Frontend running at http://localhost:3000${NC}"
else
    echo -e "${YELLOW}      ⚠ Frontend may still be starting...${NC}"
fi

# Step 6: Run auto-test script to open 4 tabs
echo -e "${BLUE}[6/6] Running auto-test to open 4 browser tabs...${NC}"
cd "$FRONTEND_DIR"
node scripts/auto-test.js || {
    echo -e "${YELLOW}      ⚠ Auto-test script failed (this is OK if you don't want auto-tabs)${NC}"
}

# Display final status
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                   ✅ ALL SERVICES STARTED                  ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║                                                           ║"
echo "║   Frontend:     http://localhost:3000                     ║"
echo "║   Backend API:  http://localhost:3001                     ║"
echo "║   WebSocket:    ws://localhost:3001/ws                     ║"
echo "║   DynamoDB:     http://localhost:8000                     ║"
echo "║                                                           ║"
echo "║   4 browser tabs should have opened automatically!        ║"
echo "║   Press Ctrl+C to stop all services                       ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Wait for processes
wait $FRONTEND_PID $BACKEND_PID
