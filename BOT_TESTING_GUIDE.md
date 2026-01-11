# Bot System Testing Guide

## Prerequisites

1. **Restart the backend server** to pick up the new `/addBot` route:
   ```bash
   # Stop the current server (Ctrl+C if running in terminal)
   # Then restart:
   cd backend
   DYNAMODB_ENDPOINT=http://localhost:8000 node local/server.js
   ```

2. Ensure DynamoDB Local is running:
   ```bash
   cd backend
   docker-compose up -d
   ```

3. Frontend should be running on http://localhost:3000

## Manual Testing Steps

### Test 1: Add Bots to Game

1. Open http://localhost:3000 in your browser
2. Enter your name (e.g., "TestPlayer")
3. Click "Create New Game"
4. You should see the waiting lobby with:
   - Your name at seat 0 (Host)
   - An "Add Bot" button below the game code
5. Click "Add Bot" - you should see "Bot 1" appear at seat 1
6. Click "Add Bot" again - "Bot 2" should appear at seat 2
7. Click "Add Bot" one more time - "Bot 3" should appear at seat 3
8. The game should now show status "FULL" with 4 players

**Expected Result:**
- ✅ Bots appear with 🤖 icon
- ✅ Button shows "Add Bot (X/4)" and updates
- ✅ Button disappears when game is full
- ✅ All 4 seats are occupied

### Test 2: Select Bot as Partner

1. With 4 players (you + 3 bots), click "Start Game"
2. Partner selection modal should appear
3. You should see all 3 bots listed as partner options (with 🤖 icon)
4. Click on "Bot 1" (or any bot) to select as partner
5. Game should proceed to bidding phase

**Expected Result:**
- ✅ Bots appear in partner selection with 🤖 icon
- ✅ Can select a bot as partner
- ✅ Game transitions to BIDDING status
- ✅ Cards are dealt

### Test 3: Bot Bidding

1. After partner selection, bidding should start automatically
2. Watch the console/logs - you should see:
   - Bot actions being scheduled
   - Bots making bid decisions
   - Bots passing or bidding
3. Bots should bid with ~1 second delay between actions
4. Bidding should complete automatically

**Expected Result:**
- ✅ Bots bid automatically (no user interaction needed)
- ✅ ~1 second delay between bot actions
- ✅ Bots make reasonable bid decisions
- ✅ Bidding completes and a winner is determined

### Test 4: Bot Trump Selection and Discarding

1. If a bot wins the bid, they should automatically:
   - Receive the kitty (5 cards)
   - Select a trump suit
   - Discard 5 cards
2. This should happen automatically with ~1.5 second delay after winning bid

**Expected Result:**
- ✅ Bot receives kitty automatically
- ✅ Bot selects trump suit (based on hand strength)
- ✅ Bot discards 5 cards (keeping high-value and trump cards)
- ✅ Game transitions to PLAYING status

### Test 5: Bot Card Playing

1. Once play starts, bots should automatically play cards
2. Each bot action should have ~1 second delay
3. Bots should:
   - Follow suit when possible
   - Play strategically (support teammates, try to win valuable tricks)
   - Lead appropriately

**Expected Result:**
- ✅ Bots play cards automatically
- ✅ ~1 second delay between each bot play
- ✅ Bots follow suit rules correctly
- ✅ Game progresses through tricks automatically
- ✅ Tricks are won and points are scored

### Test 6: Full Game with Different Bot Counts

Test with different combinations:

**1 Bot + 3 Real Players:**
- Create game, add 1 bot
- Have 2 other real players join
- Test full game flow

**2 Bots + 2 Real Players:**
- Create game, add 2 bots
- Have 1 other real player join
- Test full game flow

**3 Bots + 1 Real Player:**
- Create game, add 3 bots
- Test full game flow (you play alone with 3 bots)

## Automated Testing

Run the test script (after restarting server):

```bash
cd backend
node test-bots.js
```

This will:
1. Create a game
2. Add 3 bots
3. Select a bot as partner
4. Wait for bots to bid
5. Wait for bots to select trump
6. Wait for bots to play cards

## Troubleshooting

### Issue: "Cannot POST /addBot"
**Solution:** Restart the backend server to pick up the new route

### Issue: Bots not bidding/playing
**Check:**
1. Server logs for bot action scheduling
2. Console for errors in botAction handler
3. Ensure game state is correct (status, currentBidder, etc.)

### Issue: Bot actions happening too fast/slow
**Check:**
- Delay is set to 1000ms (1 second) in `botUtils.js`
- Can adjust `scheduleBotAction` delay parameter

### Issue: Bot makes invalid moves
**Check:**
- Bot AI logic in `botAI.js`
- Card validation in `cardUtils.js`
- Game rules enforcement in `gameAction.js`

## Expected Console Output

When bots are active, you should see logs like:
```
[BOT_UTILS] Scheduling bot action for game ABC123, seat 1 in 1000ms
[BOT_ACTION] Bot 1 bidding decision: { action: 'bid', amount: 50 }
[BOT_ACTION] Bot 1 playing card: Red5
```

## Verification Checklist

- [ ] Can add bots via "Add Bot" button
- [ ] Bots appear with 🤖 icon
- [ ] Can select bot as partner
- [ ] Bots bid automatically with 1s delay
- [ ] Bots select trump automatically if they win bid
- [ ] Bots discard correctly (5 cards, keeping high-value)
- [ ] Bots play cards automatically with 1s delay
- [ ] Bots follow suit rules
- [ ] Game progresses through full hand
- [ ] Works with 1, 2, or 3 bots
- [ ] No changes when 4 real players (no bots)
