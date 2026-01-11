# Bot Debugging Guide - CloudWatch Logs

This guide explains how to query and analyze CloudWatch logs to debug bot actions in the Rook game.

## Table of Contents
- [Quick Reference](#quick-reference)
- [Log Groups](#log-groups)
- [Log Prefixes](#log-prefixes)
- [Common Queries](#common-queries)
- [Debugging Workflows](#debugging-workflows)
- [Understanding Log Messages](#understanding-log-messages)

---

## Quick Reference

**Stack Name:** `rook-game`  
**Region:** `us-east-1`  
**Main Bot Function:** `BotAction`  
**Log Group Pattern:** `/aws/lambda/rook-game-{FunctionName}`

---

## Log Groups

The following log groups contain bot-related logs:

| Log Group | Function | Purpose |
|-----------|----------|---------|
| `/aws/lambda/rook-game-BotAction` | Bot Action Handler | Direct bot actions (bidding, playing cards, trump selection) |
| `/aws/lambda/rook-game-WebSocketRouterFunction` | WebSocket Router | Game actions that trigger bot scheduling |
| `/aws/lambda/rook-game-ChoosePartnerFunction` | Partner Selection | Partner selection that may trigger bot actions |
| `/aws/lambda/rook-game-StartNextHandFunction` | Next Hand | Starting new hands (bots may be dealers) |
| `/aws/lambda/rook-game-GameActionFunction` | Game Actions | General game actions (if separate function exists) |

**Note:** `gameAction.js` is often called from other functions, so bot scheduling logs may appear in multiple log groups.

---

## Log Prefixes

All bot-related logs use consistent prefixes for easy filtering:

| Prefix | Source | Purpose |
|--------|--------|---------|
| `[BOT_ACTION]` | `botAction.js` | Bot action execution and decisions |
| `[BOT_UTILS]` | `botUtils.js` | Bot scheduling and Lambda invocation |
| `[GAME_ACTION]` | `gameAction.js` | Game state changes and bot scheduling triggers |
| `[WS-DEBUG]` | `websocket.js` | WebSocket broadcasts (including bot connection failures) |

---

## Common Queries

### 1. View All Bot Actions for a Specific Game

```bash
# Replace GAMECODE with your game code (e.g., NCBFQZ)
GAMECODE="NCBFQZ"
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --filter-pattern "$GAMECODE" \
  --start-time $(($(date +%s) - 3600))000 \
  --query 'events[*].message' \
  --output text
```

**What to look for:**
- `[BOT_ACTION] Event:` - Bot action invocation
- `[BOT_ACTION] Bot X bidding decision:` - Bid decision
- `[BOT_ACTION] Bot X playing card:` - Card played
- `[BOT_ACTION] Bot X action completed:` - Action result (200 = success, 400/500 = error)

---

### 2. Check Bot Scheduling (Why Bots Aren't Acting)

```bash
GAMECODE="NCBFQZ"
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-WebSocketRouterFunction" \
  --filter-pattern "$GAMECODE" \
  --start-time $(($(date +%s) - 3600))000 \
  --query 'events[*].message' \
  --output text | grep -E "\[BOT_UTILS\]|\[GAME_ACTION\].*Scheduling"
```

**What to look for:**
- `[BOT_UTILS] Scheduling bot action for game X, seat Y` - Bot scheduled successfully
- `[BOT_UTILS] Lambda async invocation sent for bot X` - Lambda invocation sent
- `[BOT_UTILS] BOT_ACTION_FUNCTION_NAME not set` - **ERROR:** Missing environment variable
- `[BOT_UTILS] Failed to invoke Lambda` - **ERROR:** Lambda invocation failed
- `[GAME_ACTION] Scheduling bot action for seat X` - Game action triggered bot scheduling

---

### 3. Find Bot Errors

```bash
GAMECODE="NCBFQZ"
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --filter-pattern "$GAMECODE" \
  --start-time $(($(date +%s) - 3600))000 \
  --query 'events[*].message' \
  --output text | grep -E "ERROR|Error|error|400|500"
```

**What to look for:**
- `[BOT_ACTION] Error:` - Exception in bot action
- `[BOT_ACTION] Bot X action completed: 400` - Bad request (wrong turn, invalid action)
- `[BOT_ACTION] Bot X action completed: 500` - Internal server error
- `[BOT_ACTION] Game X not found` - Game doesn't exist
- `[BOT_ACTION] Seat X is not a bot` - Seat validation failed

---

### 4. Check Bot Decision Logic

```bash
GAMECODE="NCBFQZ"
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --filter-pattern "$GAMECODE" \
  --start-time $(($(date +%s) - 3600))000 \
  --query 'events[*].message' \
  --output text | grep -E "bidding decision|choosing trump|playing card"
```

**What to look for:**
- `[BOT_ACTION] Bot X bidding decision: {"action":"bid","amount":80}` - Bid decision
- `[BOT_ACTION] Bot X bidding decision: {"action":"pass"}` - Pass decision
- `[BOT_ACTION] Bot X choosing trump: Black, discarding: [...]` - Trump and discard choices
- `[BOT_ACTION] Bot X playing card: Black12` - Card selection

---

### 5. Verify Bot Turn Validation

```bash
GAMECODE="NCBFQZ"
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --filter-pattern "$GAMECODE" \
  --start-time $(($(date +%s) - 3600))000 \
  --query 'events[*].message' \
  --output text | grep -E "not the current|not the bidder|not the bid winner|current player"
```

**What to look for:**
- `[BOT_ACTION] Bot X is not the current bidder (current: Y)` - Bot tried to bid out of turn
- `[BOT_ACTION] Bot X is not the bid winner (winner: Y)` - Bot tried to select trump but didn't win
- `[BOT_ACTION] Bot X is not the current player (current: Y)` - Bot tried to play out of turn

**Note:** These are often **expected** - bots may be scheduled but the game state changed before they acted.

---

### 6. Check WebSocket Broadcast Failures (Expected for Bots)

```bash
GAMECODE="NCBFQZ"
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-WebSocketRouterFunction" \
  --filter-pattern "$GAMECODE" \
  --start-time $(($(date +%s) - 3600))000 \
  --query 'events[*].message' \
  --output text | grep -E "Invalid connectionId|bot_"
```

**What to look for:**
- `Invalid connectionId: bot_GAMECODE_X` - **EXPECTED:** Bots don't have real WebSocket connections
- These failures are normal and don't affect game logic (bot actions use Lambda, not WebSocket)

---

### 7. View Recent Bot Activity (Last 5 Minutes)

```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --start-time $(($(date +%s) - 300))000 \
  --limit 50 \
  --query 'events[*].message' \
  --output text | grep -E "\[BOT_ACTION\]"
```

---

### 8. Full Bot Action Flow for a Game

```bash
GAMECODE="NCBFQZ"
START_TIME=$(($(date +%s) - 3600))000

# Bot actions
echo "=== BOT ACTIONS ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --filter-pattern "$GAMECODE" \
  --start-time $START_TIME \
  --query 'events[*].message' \
  --output text

# Bot scheduling
echo -e "\n=== BOT SCHEDULING ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-WebSocketRouterFunction" \
  --filter-pattern "$GAMECODE" \
  --start-time $START_TIME \
  --query 'events[*].message' \
  --output text | grep -E "\[BOT_UTILS\]|\[GAME_ACTION\].*bot"
```

---

## Debugging Workflows

### Workflow 1: Bot Not Bidding

**Symptoms:** Bot should bid but doesn't act.

**Steps:**
1. Check if bot was scheduled:
   ```bash
   GAMECODE="YOURCODE"
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-WebSocketRouterFunction" \
     --filter-pattern "$GAMECODE" \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[*].message' \
     --output text | grep -E "Scheduling bot action|Lambda async invocation"
   ```

2. If scheduled, check if Lambda was invoked:
   ```bash
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-BotAction" \
     --filter-pattern "$GAMECODE" \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[*].message' \
     --output text | grep "\[BOT_ACTION\] Event:"
   ```

3. If invoked, check for errors:
   ```bash
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-BotAction" \
     --filter-pattern "$GAMECODE" \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[*].message' \
     --output text | grep -E "Error|400|500|not the current"
   ```

**Common Issues:**
- `BOT_ACTION_FUNCTION_NAME not set` → Missing environment variable in `template.yaml`
- `Failed to invoke Lambda` → IAM permission issue
- `Bot X is not the current bidder` → Game state changed (may be expected)
- No `[BOT_ACTION] Event:` → Lambda not invoked (check `scheduleBotAction` calls)

---

### Workflow 2: Bot Action Returns 400 Error

**Symptoms:** Bot action completes with status 400.

**Steps:**
1. Find the error:
   ```bash
   GAMECODE="YOURCODE"
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-BotAction" \
     --filter-pattern "$GAMECODE" \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[*].message' \
     --output text | grep -A 5 "action completed: 400"
   ```

2. Check game action logs for the actual error:
   ```bash
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-WebSocketRouterFunction" \
     --filter-pattern "$GAMECODE" \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[*].message' \
     --output text | grep -E "Invalid|Not your turn|400"
   ```

**Common Issues:**
- `Invalid bid` → Bot bid amount too low or invalid
- `Not your turn` → Player-seat mismatch (check `playerName` vs `connectionId` after seat rearrangement)
- `Game not found` → Game ID mismatch or game deleted

---

### Workflow 3: Bot Plays Wrong Card

**Symptoms:** Bot makes suboptimal card play.

**Steps:**
1. View bot's decision:
   ```bash
   GAMECODE="YOURCODE"
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-BotAction" \
     --filter-pattern "$GAMECODE" \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[*].message' \
     --output text | grep "playing card:"
   ```

2. Check game context at time of play:
   ```bash
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-WebSocketRouterFunction" \
     --filter-pattern "$GAMECODE" \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[*].message' \
     --output text | grep -E "currentTrick|ledSuit|trump"
   ```

**Note:** This is usually an AI logic issue, not a bug. Check `botAI.js` decision logic.

---

## Understanding Log Messages

### Bot Action Event Structure

```
[BOT_ACTION] Event: {"body":"{\"gameId\":\"NCBFQZ\",\"botSeat\":1,\"delayMs\":1000}"}
```

- `gameId`: Game code
- `botSeat`: Bot's seat number (0-3)
- `delayMs`: Delay before action (production only)

---

### Bot Bidding Decision

```
[BOT_ACTION] Bot 1 bidding decision: {"action":"bid","amount":80}
[BOT_ACTION] Bot 1 bidding decision: {"action":"pass"}
```

- `action`: `"bid"` or `"pass"`
- `amount`: Bid amount (only if `action === "bid"`)

---

### Bot Trump Selection

```
[BOT_ACTION] Bot 3 (Bot 3) choosing trump: Black, discarding: ["Red2","Green5","Yellow8","Black3","Red7"]
```

- `trump`: Selected trump suit
- `discarding`: Array of 5 cards to discard

---

### Bot Card Play

```
[BOT_ACTION] Bot 1 (Bot 1) playing card: Black12
```

- Card format: `{Suit}{Rank}` (e.g., `Black12`, `Rook`)

---

### Bot Scheduling

```
[BOT_UTILS] Scheduling bot action for game NCBFQZ, seat 1 in 1500ms
[BOT_UTILS] Lambda async invocation sent for bot 1 in game NCBFQZ
```

- `seat`: Bot seat to schedule
- `delayMs`: Delay before action
- Second line confirms Lambda invocation was sent

---

### Bot Action Completion

```
[BOT_ACTION] Bot 1 action completed: 200
[BOT_ACTION] Bot 1 action completed: 400
```

- `200`: Success
- `400`: Bad request (wrong turn, invalid action)
- `500`: Internal server error

---

## Tips

1. **Use timestamps:** Always specify `--start-time` to limit results (CloudWatch has limits)
2. **Filter by game code:** Use `--filter-pattern` with game code for focused results
3. **Check multiple log groups:** Bot actions may appear in different groups depending on which function triggered them
4. **Expected errors:** `Invalid connectionId: bot_*` errors are normal (bots don't have WebSocket connections)
5. **Time windows:** Use recent time windows (last hour) for active debugging
6. **Combine filters:** Use `grep` to further filter results after CloudWatch queries

---

## Example: Complete Debug Session

```bash
# Set your game code
GAMECODE="NCBFQZ"
START_TIME=$(($(date +%s) - 1800))000  # Last 30 minutes

echo "=== 1. Bot Actions ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --filter-pattern "$GAMECODE" \
  --start-time $START_TIME \
  --query 'events[*].message' \
  --output text | head -20

echo -e "\n=== 2. Bot Scheduling ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-WebSocketRouterFunction" \
  --filter-pattern "$GAMECODE" \
  --start-time $START_TIME \
  --query 'events[*].message' \
  --output text | grep -E "\[BOT_UTILS\]|\[GAME_ACTION\].*Scheduling" | head -20

echo -e "\n=== 3. Errors ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/rook-game-BotAction" \
  --filter-pattern "$GAMECODE" \
  --start-time $START_TIME \
  --query 'events[*].message' \
  --output text | grep -iE "error|400|500" | head -10
```

---

## Troubleshooting

### No logs appearing?

1. **Check log group exists:**
   ```bash
   aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/rook-game"
   ```

2. **Check time window:** Increase `--start-time` window (logs may be older)

3. **Check region:** Ensure you're querying `us-east-1`:
   ```bash
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/rook-game-BotAction" \
     --region us-east-1 \
     ...
   ```

### Too many logs?

1. **Narrow time window:** Reduce `--start-time` offset
2. **Use filter pattern:** Add more specific patterns
3. **Limit results:** Use `--limit` parameter
4. **Post-filter with grep:** Use `grep` to filter after query

---

## Additional Resources

- **AWS CLI Documentation:** https://docs.aws.amazon.com/cli/latest/reference/logs/
- **CloudWatch Logs Insights:** Use CloudWatch Logs Insights in AWS Console for more advanced queries
- **Local Testing:** Use `test-bots-full.js` for local bot testing before production debugging
