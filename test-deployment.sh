#!/bin/bash

# Quick test script to verify deployment

set -e

ENV_FILE=".deployment-env"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .deployment-env file not found. Please deploy first using ./deploy.sh"
    exit 1
fi

source "$ENV_FILE"

echo "🧪 Testing Rook Deployment"
echo "=========================="
echo ""

# Test HTTP API
echo "📡 Testing HTTP API..."
echo "URL: $REACT_APP_API_BASE_URL"
echo ""

# Test createGame
echo "1. Testing /createGame..."
RESPONSE=$(curl -s -X POST "$REACT_APP_API_BASE_URL/createGame" \
  -H "Content-Type: application/json" \
  -d '{"hostName": "TestPlayer"}')

if echo "$RESPONSE" | grep -q "gameId"; then
    GAME_ID=$(echo "$RESPONSE" | grep -o '"gameId":"[^"]*' | cut -d'"' -f4)
    echo "   ✅ Game created: $GAME_ID"
    echo "   Response: $RESPONSE" | head -c 200
    echo ""
else
    echo "   ❌ Failed to create game"
    echo "   Response: $RESPONSE"
    exit 1
fi

# Test joinGame
if [ -n "$GAME_ID" ]; then
    echo "2. Testing /joinGame..."
    JOIN_RESPONSE=$(curl -s -X POST "$REACT_APP_API_BASE_URL/joinGame" \
      -H "Content-Type: application/json" \
      -d "{\"gameId\": \"$GAME_ID\", \"playerName\": \"TestPlayer2\"}")
    
    if echo "$JOIN_RESPONSE" | grep -q "seat"; then
        echo "   ✅ Player joined successfully"
        echo "   Response: $JOIN_RESPONSE" | head -c 200
        echo ""
    else
        echo "   ⚠️  Join response: $JOIN_RESPONSE"
    fi
fi

# Test WebSocket
echo "3. Testing WebSocket URL..."
echo "   URL: $REACT_APP_WS_BASE_URL"
if command -v wscat &> /dev/null; then
    echo "   ℹ️  wscat installed - you can test with:"
    echo "      wscat -c \"$REACT_APP_WS_BASE_URL?gameId=$GAME_ID&playerName=Test&seat=0\""
else
    echo "   ℹ️  Install wscat to test: npm install -g wscat"
fi
echo ""

# Get Frontend URL
if [ -n "$DISTRIBUTION_ID" ]; then
    FRONTEND_URL=$(aws cloudfront get-distribution \
        --id "$DISTRIBUTION_ID" \
        --query 'Distribution.DomainName' \
        --output text 2>/dev/null || echo "deploying...")
    
    echo "4. Frontend URL:"
    echo "   https://$FRONTEND_URL"
    echo ""
    
    STATUS=$(aws cloudfront get-distribution \
        --id "$DISTRIBUTION_ID" \
        --query 'Distribution.Status' \
        --output text 2>/dev/null || echo "Unknown")
    
    if [ "$STATUS" = "Deployed" ]; then
        echo "   ✅ CloudFront is deployed"
    else
        echo "   ⚠️  CloudFront status: $STATUS (may still be deploying)"
    fi
else
    echo "4. Frontend: Not deployed yet"
fi

echo ""
echo "✅ Basic tests complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Open frontend URL in browser"
echo "   2. Create a game"
echo "   3. Open 3 more tabs and join the game"
echo "   4. Test the full game flow"
echo ""
