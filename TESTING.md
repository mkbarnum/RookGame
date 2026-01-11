# Testing Your AWS Deployment

## Getting Your URLs

After running `./deploy.sh`, you'll get URLs in two ways:

### 1. From Deployment Output

The deployment scripts will display URLs at the end:

```
╔═══════════════════════════════════════════════════════════╗
║              🎉 DEPLOYMENT COMPLETE                         ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Backend HTTP API:  https://abc123xyz.execute-api.us-east-1.amazonaws.com
║   Backend WebSocket: wss://xyz789abc.execute-api.us-east-1.amazonaws.com/prod
║   Frontend URL:      https://d111111abcdef8.cloudfront.net
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

### 2. From .deployment-env File

After deployment, check `.deployment-env`:

```bash
cat .deployment-env
```

This file contains:
- `REACT_APP_API_BASE_URL` - HTTP API URL
- `REACT_APP_WS_BASE_URL` - WebSocket URL
- `DISTRIBUTION_ID` - CloudFront distribution ID

### 3. From AWS Console

**Backend URLs:**
```bash
# Get HTTP API URL
aws cloudformation describe-stacks \
  --stack-name rook-game \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiUrl`].OutputValue' \
  --output text

# Get WebSocket URL
aws cloudformation describe-stacks \
  --stack-name rook-game \
  --query 'Stacks[0].Outputs[?OutputKey==`WebSocketApiUrl`].OutputValue' \
  --output text
```

**Frontend URL:**
```bash
# Get CloudFront URL (replace DISTRIBUTION_ID)
aws cloudfront get-distribution \
  --id <DISTRIBUTION_ID> \
  --query 'Distribution.DomainName' \
  --output text
```

## Testing the Frontend

### 1. Open the Frontend URL

Simply open your CloudFront URL in a browser:
```
https://d111111abcdef8.cloudfront.net
```

**Note:** If CloudFront is still deploying (first time), wait 15-20 minutes, then check:
```bash
aws cloudfront get-distribution --id <DISTRIBUTION_ID> --query 'Distribution.Status'
```

Status should be `Deployed`.

### 2. Test Game Flow

1. **Create a Game:**
   - Enter your name
   - Click "Create Game"
   - You'll get a game code (e.g., "ABCDEF")

2. **Join the Game:**
   - Open the same URL in 3 more browser tabs/windows
   - Enter the game code and different player names
   - Click "Join Game"

3. **Select Partner:**
   - Host (first player) selects their partner
   - Teams are assigned

4. **Play the Game:**
   - Bidding phase
   - Trump selection
   - Card playing
   - Scoring

## Testing the Backend APIs

### Test HTTP API

**1. Create a Game:**
```bash
# Replace <HTTP_API_URL> with your actual URL
curl -X POST https://<HTTP_API_URL>/createGame \
  -H "Content-Type: application/json" \
  -d '{"hostName": "Alice"}'
```

Expected response:
```json
{
  "success": true,
  "gameId": "ABCDEF",
  "seat": 0,
  "game": {
    "gameId": "ABCDEF",
    "hostName": "Alice",
    "players": [{"seat": 0, "name": "Alice"}],
    "status": "LOBBY"
  }
}
```

**2. Join a Game:**
```bash
curl -X POST https://<HTTP_API_URL>/joinGame \
  -H "Content-Type: application/json" \
  -d '{"gameId": "ABCDEF", "playerName": "Bob"}'
```

**3. Health Check:**
```bash
curl https://<HTTP_API_URL>/health
```

### Test WebSocket API

**Using wscat (install: `npm install -g wscat`):**

```bash
# Connect to WebSocket (replace <WS_API_URL> and gameId)
wscat -c "wss://<WS_API_URL>?gameId=ABCDEF&playerName=Alice&seat=0"

# Once connected, send a message:
{"action": "playCard", "card": "Green14"}
```

**Using Browser Console:**

Open browser console on your frontend page and the WebSocket connection should be automatic when you join a game.

## Testing Checklist

### ✅ Backend Tests

- [ ] HTTP API responds to `/createGame`
- [ ] HTTP API responds to `/joinGame`
- [ ] HTTP API responds to `/choosePartner`
- [ ] WebSocket connects successfully
- [ ] WebSocket receives messages
- [ ] WebSocket sends messages

### ✅ Frontend Tests

- [ ] Frontend loads at CloudFront URL
- [ ] Can create a game
- [ ] Can join a game with code
- [ ] Can see other players joining
- [ ] Partner selection works
- [ ] Game starts correctly
- [ ] Cards are displayed
- [ ] Can play cards (if handlers are implemented)
- [ ] Real-time updates work

### ✅ Full Game Flow Test

1. Open frontend in 4 browser tabs/windows
2. Create game in tab 1
3. Join game in tabs 2, 3, 4
4. Select partner in tab 1
5. Complete bidding phase
6. Select trump suit
7. Play cards
8. Complete a hand
9. Verify scoring

## Troubleshooting

### Frontend Shows "Connection Error"

1. Check that backend is deployed:
   ```bash
   aws cloudformation describe-stacks --stack-name rook-game
   ```

2. Verify API URLs in `.deployment-env` are correct

3. Check CORS is enabled (should be `*` in template)

4. Open browser console to see specific error

### WebSocket Won't Connect

1. Verify WebSocket URL format:
   ```
   wss://<api-id>.execute-api.<region>.amazonaws.com/prod
   ```

2. Check Lambda function logs:
   ```bash
   aws logs tail /aws/lambda/rook-game-ConnectFunction --follow
   ```

3. Test connection with wscat (see above)

### CloudFront Shows "Access Denied"

1. Check S3 bucket policy allows CloudFront
2. Verify CloudFront distribution is enabled
3. Wait for CloudFront to finish deploying (15-20 min)

### API Returns 500 Errors

1. Check Lambda function logs:
   ```bash
   # List all Lambda functions
   aws lambda list-functions --query 'Functions[?contains(FunctionName, `rook-game`)].FunctionName'
   
   # View logs for a specific function
   aws logs tail /aws/lambda/<function-name> --follow
   ```

2. Check DynamoDB tables exist:
   ```bash
   aws dynamodb list-tables
   ```

3. Verify environment variables are set correctly

## Quick Test Script

Create a test script to verify everything works:

```bash
#!/bin/bash
# test-deployment.sh

source .deployment-env

echo "Testing HTTP API..."
curl -X POST "$REACT_APP_API_BASE_URL/createGame" \
  -H "Content-Type: application/json" \
  -d '{"hostName": "TestPlayer"}' \
  | jq '.'

echo ""
echo "Testing WebSocket (requires wscat)..."
echo "Connect to: $REACT_APP_WS_BASE_URL?gameId=TEST&playerName=Test&seat=0"

echo ""
echo "Frontend URL: https://$(aws cloudfront get-distribution --id $DISTRIBUTION_ID --query 'Distribution.DomainName' --output text)"
```

Run with:
```bash
chmod +x test-deployment.sh
./test-deployment.sh
```

## Expected URLs Format

After deployment, your URLs will look like:

- **HTTP API:** `https://abc123xyz.execute-api.us-east-1.amazonaws.com`
- **WebSocket:** `wss://xyz789abc.execute-api.us-east-1.amazonaws.com/prod`
- **Frontend:** `https://d111111abcdef8.cloudfront.net`

All URLs are AWS-provided - no custom domain needed!
