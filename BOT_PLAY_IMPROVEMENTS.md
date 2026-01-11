# Bot Play Style Review and Improvements

## Current Strengths
- ✅ Follows suit correctly
- ✅ Tracks cards played to avoid playing 14 when 1 hasn't been played
- ✅ Doesn't overtake partner's winning tricks
- ✅ Feeds partner points when partner is winning and we're last to play
- ✅ Avoids leading point cards when non-point alternatives exist
- ✅ Strategic trump pulling when offensive
- ✅ Defensive play avoids leading trump

## Areas for Improvement

### 1. **Feeding Partner Rook When Safe** ⚠️ HIGH PRIORITY
**Current behavior**: Never feeds Rook to partner, even when partner is winning and we're last to play.

**Guide says**: "that is a great time to dump a 5 or 10 of another suit (or even the Rook, if it's a safe play)"

**Improvement needed**: Allow feeding Rook when:
- Partner is winning the trick
- We're last to play (perfect information)
- It's safe (no risk of opponent overtaking)

**Location**: `backend/shared/botAI.js` line ~910-927 (TEAMMATE/PARTNER IS WINNING section)

### 2. **Feeding Partner When Not Last to Play** ⚠️ MEDIUM PRIORITY
**Current behavior**: Only feeds points when we're last to play.

**Guide says**: Feed partner points when partner is winning (doesn't specify only when last)

**Improvement needed**: Consider feeding smaller point cards (5s, 10s) to partner even when not last to play, if we're following suit and can safely dump them.

**Location**: `backend/shared/botAI.js` line ~907-927

### 3. **Partner Leading Strategy** ⚠️ MEDIUM PRIORITY
**Current behavior**: Doesn't consider what card partner led.

**Guide says**: 
- "if partner leads a 13 and you have the 1 of that suit, you might play a lower card instead of the 1, trusting your partner's 13 will win"
- "if partner leads something low, you may play high to try to take the trick if you have strength in that suit"

**Improvement needed**: When partner led the trick:
- If partner led high (13, 14) → play lower (trust partner)
- If partner led low → play high if we have strength
- Consider partner's card rank when deciding to play high or low

**Location**: `backend/shared/botAI.js` - Need to detect if partner led and check their card rank

### 4. **Offensive Trump Pulling Strategy** ⚠️ LOW PRIORITY
**Current behavior**: When pulling trump, prefers non-point trump, and when only point trump available, saves the 1.

**Guide says**: "lead with a medium or lower high trump first – something strong enough that only the very highest trump could beat it – to lure out the opponents' top trump cards. For instance, if you hold the 1 of trump and 13 of trump, you might lead the 13"

**Improvement needed**: When we have both 1 and 13 (or 14) of trump, lead the 13/14 first to draw out opponent's 1, then play our 1 on next round.

**Location**: `backend/shared/botAI.js` line ~1159-1196 (OFFENSIVE PLAY section)

### 5. **Void + Opponent Winning - Trump Strategy** ⚠️ LOW PRIORITY
**Current behavior**: When void and opponent winning, calculates winningPlays which includes trump, and trumps in if valuable trick.

**Status**: This seems to work correctly already, but the logic could be clearer. The guide emphasizes trumping in when opponent is winning with a high card and trick is valuable. Current threshold is 10 points or last to play with 5+ points.

**Potential improvement**: Could be more aggressive about trumping in when void, especially if opponent is winning with a very high card (like a 1).

**Location**: `backend/shared/botAI.js` line ~1011-1041

### 6. **Never Overtake Partner with Trump** ✅ ALREADY CORRECT
**Current behavior**: Correctly avoids overtaking partner - entire "TEAMMATE/PARTNER IS WINNING" section prevents this.

**Status**: No change needed.

### 7. **Defensive Leading Strategy** ✅ MOSTLY CORRECT
**Current behavior**: Avoids leading trump, leads suits where we have the 1, prefers non-point cards.

**Guide says**: "lead a low point card (like a 5) to tempt the opponent to waste a high trump"

**Potential improvement**: Could strategically lead low point cards (5s) to tempt opponents to waste trump.

**Location**: `backend/shared/botAI.js` line ~1209-1294 (DEFENSIVE PLAY section)

## Recommended Implementation Order

1. **Feeding Partner Rook** (High priority, easy fix)
2. **Feeding Partner When Not Last** (Medium priority, moderate complexity)
3. **Partner Leading Strategy** (Medium priority, requires detecting partner's lead)
4. **Offensive Trump Pulling** (Low priority, nice to have)
5. **Defensive Low Point Leads** (Low priority, edge case)

## Code Changes Summary

### Change 1: Allow Feeding Rook to Partner
**File**: `backend/shared/botAI.js` line ~910-927
- Remove or modify the filter that excludes Rook from safePointsToFeed
- Add condition to check if Rook can be safely fed (partner winning, we're last)

### Change 2: Feed Partner When Not Last
**File**: `backend/shared/botAI.js` line ~907-927
- Move feeding logic outside of `isLastToPlay` condition
- Adjust to feed smaller points when not last (only 5s, maybe 10s, not Rook or 14s)

### Change 3: Partner Leading Strategy
**File**: `backend/shared/botAI.js` - Following suit logic
- Detect if partner led (check if `currentTrick[0].seat === partnerSeat`)
- Get partner's card rank
- If partner led high (13+) and we have higher (1), play lower
- If partner led low, play high if we have strength

### Change 4: Strategic Trump Pulling
**File**: `backend/shared/botAI.js` line ~1159-1196
- When pulling trump and we have both 1 and 13/14, lead 13/14 first
- Save 1 for next round

### Change 5: Defensive Low Point Leads
**File**: `backend/shared/botAI.js` line ~1209-1294
- Add option to lead low point cards (5s) to tempt opponents
