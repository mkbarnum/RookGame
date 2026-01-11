# Deployment Notes and Known Issues

## Known Issues

### Missing Handler Implementations

The following WebSocket actions are currently only implemented in `backend/local/server.js` and need to be extracted into proper Lambda handlers:

- **bid** - Bidding action
- **pass** - Pass on bidding
- **discardAndTrump** - Discard cards and select trump suit

**Current Status:** These actions are routed to `gameAction` handler via the WebSocket router, but `gameAction` only handles `playCard` and will return an error for these actions.

**Workaround:** The logic exists in `server.js` (functions `handleBiddingAction` and `handleDiscardAndTrump`). These need to be:
1. Extracted into separate handler files, OR
2. Added to `gameAction.js` to handle these action types

**Impact:** Bidding and trump selection will not work in AWS deployment until these handlers are implemented.

### Other Actions

The following actions are properly implemented:
- ✅ `playCard` - Handled by `gameAction.js`
- ✅ `choosePartner` - Handled by `choosePartner.js`
- ✅ `resetGame` - Handled by `resetGame.js`
- ✅ `startNextHand` - Handled by `startNextHand.js`
- ✅ `quickChat` - Currently only in local server, needs handler

## Next Steps

1. Extract `handleBiddingAction` logic from `server.js` into a proper handler
2. Extract `handleDiscardAndTrump` logic from `server.js` into a proper handler
3. Add `quickChat` handler if needed
4. Update WebSocket router to route to these new handlers
5. Test all actions in AWS deployment

## Testing

After deployment, test the following:
- ✅ Game creation (HTTP)
- ✅ Game joining (HTTP)
- ✅ Partner selection (HTTP)
- ✅ WebSocket connection
- ⚠️ Bidding (needs handler)
- ⚠️ Trump selection (needs handler)
- ✅ Card playing (WebSocket)
- ✅ Game reset (WebSocket)
- ✅ Next hand (WebSocket)
