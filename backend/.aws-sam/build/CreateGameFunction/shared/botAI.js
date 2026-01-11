/**
 * Bot AI decision-making logic for Rook game
 * 
 * Bidding Strategy based on Rook rules:
 * - Most final bids range from 90-120+ points
 * - Bidding beyond 130 is rare (only with exceptional hands)
 * - The Rook card (20 points, always trump) is a major advantage
 * - 1s outrank 14s and have strong trick-taking power
 * - Point values: 5=5pts, 10=10pts, 14=10pts, 1=15pts, Rook=20pts
 * - Total points available: 180 (120 in cards + 20 Rook + 20 kitty bonus + 20 last trick bonus)
 */

const { getCardSuit, getCardRank, getCardPointValue, isPointCard, getCardPlayValue, 
        compareCards, getValidPlays, countCardsBySuit, sortCardsByValue, 
        calculateHandPoints } = require('./cardUtils');
const { BID_MIN, BID_INCREMENT } = require('./gameUtils');

/**
 * Check if a specific card has been played
 * @param {string} card - Card to check (e.g., "Red1")
 * @param {Array<string>} cardsPlayed - Array of all cards played in the current hand
 * @returns {boolean} True if card has been played
 */
function hasCardBeenPlayed(card, cardsPlayed) {
  if (!cardsPlayed || cardsPlayed.length === 0) return false;
  return cardsPlayed.includes(card);
}

/**
 * Analyze a suit for trump potential
 * @param {Array<string>} hand - Player's hand
 * @param {string} suit - Suit to analyze
 * @returns {object} Suit analysis { count, points, highCards, has1, has14, strength }
 */
function analyzeSuit(hand, suit) {
  const suitCards = hand.filter(card => getCardSuit(card) === suit);
  const count = suitCards.length;
  
  let points = 0;
  let highCards = 0;
  let has1 = false;
  let has14 = false;
  
  for (const card of suitCards) {
    const rank = getCardRank(card);
    points += getCardPointValue(card);
    
    if (rank === 1) {
      has1 = true;
      highCards++;
    } else if (rank === 14) {
      has14 = true;
      highCards++;
    } else if (rank >= 12) {
      highCards++; // 12, 13 are also decent high cards
    }
  }
  
  // Calculate suit strength score (for trump selection potential)
  // Long suits with high cards make the best trump
  const strength = (count * 10) + (points) + (highCards * 5) + (has1 ? 15 : 0) + (has14 ? 8 : 0);
  
  return { count, points, highCards, has1, has14, strength };
}

/**
 * Evaluate hand strength for bidding with detailed analysis
 * @param {Array<string>} hand - Player's hand (13 cards)
 * @returns {object} Detailed hand evaluation
 */
function evaluateHandStrength(hand) {
  if (!hand || hand.length === 0) {
    return { 
      strength: 0, 
      estimatedPoints: 0, 
      hasRook: false, 
      totalHighCards: 0,
      bestSuit: null,
      handQuality: 'poor'
    };
  }

  const suits = ['Red', 'Green', 'Yellow', 'Black'];
  const suitAnalysis = {};
  
  // Analyze each suit
  for (const suit of suits) {
    suitAnalysis[suit] = analyzeSuit(hand, suit);
  }
  
  // Find best potential trump suit
  let bestSuit = null;
  let bestSuitStrength = 0;
  for (const suit of suits) {
    if (suitAnalysis[suit].strength > bestSuitStrength) {
      bestSuitStrength = suitAnalysis[suit].strength;
      bestSuit = suit;
    }
  }

  // Check for Rook
  const hasRook = hand.includes('Rook');
  
  // Count all 1s (highest trick-taking cards)
  const ones = hand.filter(card => getCardRank(card) === 1);
  const numOnes = ones.length;
  
  // Count all 14s (second highest)
  const fourteens = hand.filter(card => getCardRank(card) === 14);
  const numFourteens = fourteens.length;
  
  // Total high cards (1s, 14s)
  const totalHighCards = numOnes + numFourteens + (hasRook ? 1 : 0);
  
  // Calculate guaranteed points in hand
  const pointsInHand = calculateHandPoints(hand);
  
  // Best suit info
  const bestSuitInfo = bestSuit ? suitAnalysis[bestSuit] : null;
  const bestSuitLength = bestSuitInfo ? bestSuitInfo.count : 0;
  
  // Estimate points we can capture
  // Base: points we hold
  // Plus: estimated points from tricks won with high cards
  // Each 1 can typically win a trick worth ~12-15 points on average
  // Each 14 can typically win a trick worth ~10-12 points
  // Rook as trump gives control
  // Long trump suit means more control
  
  let estimatedTrickPoints = 0;
  
  // 1s are very powerful - each can win a high-value trick
  estimatedTrickPoints += numOnes * 14;
  
  // 14s are strong but can be beaten by 1s
  estimatedTrickPoints += numFourteens * 10;
  
  // Long trump suit bonus (more tricks won)
  if (bestSuitLength >= 5) {
    estimatedTrickPoints += (bestSuitLength - 4) * 8; // Each extra trump beyond 4 helps
  }
  
  // Rook bonus - it's the lowest trump but having it means extra control
  if (hasRook) {
    estimatedTrickPoints += 15; // Rook helps secure points and provides flexibility
  }
  
  // Having 1 in potential trump suit is huge
  if (bestSuitInfo && bestSuitInfo.has1) {
    estimatedTrickPoints += 10; // Control of trump suit
  }
  
  // Short suits can be trumped - void or singleton in off-suits is valuable
  let voidCount = 0;
  let singletonCount = 0;
  for (const suit of suits) {
    if (suit !== bestSuit) {
      if (suitAnalysis[suit].count === 0) voidCount++;
      else if (suitAnalysis[suit].count === 1) singletonCount++;
    }
  }
  estimatedTrickPoints += voidCount * 8; // Voids let us trump immediately
  estimatedTrickPoints += singletonCount * 4; // Singletons too after one play
  
  // Total estimated points (conservative estimate - don't assume we get everything)
  const estimatedPoints = Math.round(pointsInHand + (estimatedTrickPoints * 0.75));
  
  // Calculate overall strength score (0-100)
  let strength = 0;
  
  // Point cards (up to 35 points from the ~80 possible in hand)
  strength += Math.min(35, pointsInHand * 0.45);
  
  // High cards are crucial for winning tricks (up to 25 points)
  strength += Math.min(25, totalHighCards * 6);
  
  // Trump suit quality (up to 20 points)
  strength += Math.min(20, bestSuitLength * 3 + (bestSuitInfo?.highCards || 0) * 2);
  
  // Rook is a significant advantage (up to 10 points)
  if (hasRook) strength += 10;
  
  // Distribution (voids and singletons) helps (up to 10 points)
  strength += Math.min(10, voidCount * 4 + singletonCount * 2);
  
  // Determine hand quality category
  let handQuality;
  if (strength >= 75) handQuality = 'excellent';
  else if (strength >= 60) handQuality = 'strong';
  else if (strength >= 45) handQuality = 'good';
  else if (strength >= 30) handQuality = 'fair';
  else handQuality = 'poor';

  return {
    strength: Math.min(100, Math.round(strength)),
    estimatedPoints: Math.min(180, Math.round(estimatedPoints)),
    hasRook,
    numOnes,
    numFourteens,
    totalHighCards,
    pointsInHand,
    bestSuit,
    bestSuitLength,
    bestSuitInfo,
    suitAnalysis,
    voidCount,
    singletonCount,
    handQuality,
  };
}

/**
 * Decide whether to bid or pass based on comprehensive strategy
 * 
 * BID COMMUNICATION SIGNALS:
 * - 50-70: Weak hand, planning to fold soon
 * - 80-90: Good supporting/setting hand (can help partner win)
 * - 100+: Taking hand - I want to win this bid
 * - Jump to 100/125: Strong signal of excellent hand
 * 
 * CRITICAL RULES:
 * 1. NEVER let anyone take the kitty for less than 125
 * 2. If your partner folds, you MUST bid at least 120
 * 3. Use BIG jumps to communicate hand strength, not just +5 increments
 * 4. Having the Rook means bid aggressively
 * 
 * @param {Array<string>} hand - Player's hand
 * @param {number} highBid - Current high bid (0 if no bid yet)
 * @param {Array<number>} passed - Array of seats that have passed
 * @param {number|null} mySeat - Bot's seat (optional, for partner awareness)
 * @param {number|null} highBidderSeat - Seat of current high bidder (optional)
 * @param {object|null} teams - Teams object (optional)
 * @returns {object} { action: 'bid' | 'pass', amount: number | null }
 */
function decideBid(hand, highBid, passed = [], mySeat = null, highBidderSeat = null, teams = null) {
  const evaluation = evaluateHandStrength(hand);
  const { 
    strength, 
    estimatedPoints, 
    hasRook, 
    numOnes, 
    totalHighCards, 
    pointsInHand,
    bestSuitLength,
    handQuality,
  } = evaluation;
  
  console.log(`[BOT_AI] Hand evaluation: quality=${handQuality}, strength=${strength}, ` +
              `estimatedPoints=${estimatedPoints}, hasRook=${hasRook}, ` +
              `ones=${numOnes}, highCards=${totalHighCards}, pointsInHand=${pointsInHand}`);

  // CRITICAL: Minimum bid thresholds - NEVER let anyone take kitty cheap
  const ABSOLUTE_MIN_BID = 125;  // Never let anyone win for less than this
  const PARTNER_FOLDED_MIN = 120; // If partner folded, must bid at least this
  
  // Determine if partner has passed (if we have seat info)
  let partnerPassed = false;
  if (mySeat !== null && teams) {
    const myTeam = teams.team0?.includes(mySeat) ? 'team0' : 'team1';
    const partnerSeats = teams[myTeam]?.filter(s => s !== mySeat) || [];
    partnerPassed = partnerSeats.some(s => passed.includes(s));
  }
  
  // Determine if the current high bidder is an opponent
  let opponentHasBid = false;
  if (highBidderSeat !== null && mySeat !== null && teams) {
    const myTeam = teams.team0?.includes(mySeat) ? 'team0' : 'team1';
    opponentHasBid = !teams[myTeam]?.includes(highBidderSeat);
  }
  
  // Determine if partner has bid (and what they bid signals)
  let partnerBid = false;
  let partnerSignaledStrong = false; // Partner bid 100+
  let partnerSignaledHelper = false; // Partner bid 80-90
  if (highBidderSeat !== null && mySeat !== null && teams) {
    const myTeam = teams.team0?.includes(mySeat) ? 'team0' : 'team1';
    const partnerSeats = teams[myTeam]?.filter(s => s !== mySeat) || [];
    partnerBid = partnerSeats.includes(highBidderSeat);
    if (partnerBid) {
      partnerSignaledStrong = highBid >= 100;
      partnerSignaledHelper = highBid >= 80 && highBid < 100;
    }
  }
  
  console.log(`[BOT_AI] Context: partnerPassed=${partnerPassed}, opponentHasBid=${opponentHasBid}, ` +
              `partnerBid=${partnerBid}, partnerSignaledStrong=${partnerSignaledStrong}, ` +
              `highBid=${highBid}, passed=${JSON.stringify(passed)}`);
  
  // Determine hand type for bidding communication
  // "Taking hand" = I want to win the bid and take the kitty
  // "Setting hand" = I can help my partner win tricks
  // "Weak hand" = I should fold soon
  
  const isTakingHand = handQuality === 'excellent' || handQuality === 'strong' || 
                       (handQuality === 'good' && (hasRook || numOnes >= 2));
  const isSettingHand = handQuality === 'good' || 
                        (handQuality === 'fair' && (hasRook || totalHighCards >= 2));
  const isWeakHand = handQuality === 'poor' || 
                     (handQuality === 'fair' && !hasRook && totalHighCards < 2);
  
  // Calculate maximum comfortable bid based on hand strength
  let maxComfortableBid;
  
  if (handQuality === 'excellent') {
    maxComfortableBid = Math.min(150, Math.round(estimatedPoints * 0.95));
  } else if (handQuality === 'strong') {
    maxComfortableBid = Math.min(140, Math.round(estimatedPoints * 0.90));
  } else if (handQuality === 'good') {
    maxComfortableBid = Math.min(135, Math.round(estimatedPoints * 0.85));
  } else if (handQuality === 'fair') {
    maxComfortableBid = Math.min(130, Math.round(estimatedPoints * 0.80));
  } else {
    maxComfortableBid = ABSOLUTE_MIN_BID; // Even weak hands push to minimum
  }
  
  // Rook bonus
  if (hasRook) {
    maxComfortableBid = Math.max(maxComfortableBid, 135);
  }
  
  // Multiple 1s bonus
  if (numOnes >= 2) {
    maxComfortableBid = Math.min(155, maxComfortableBid + (numOnes - 1) * 10);
  }
  
  // Strong trump suit bonus
  if (bestSuitLength >= 6) {
    maxComfortableBid = Math.min(155, maxComfortableBid + 5);
  }
  
  // RULE: If partner folded, we MUST push to at least PARTNER_FOLDED_MIN
  if (partnerPassed) {
    maxComfortableBid = Math.max(maxComfortableBid, PARTNER_FOLDED_MIN);
  }
  
  // RULE: NEVER let opponent take kitty cheap
  if (opponentHasBid && highBid < ABSOLUTE_MIN_BID) {
    maxComfortableBid = Math.max(maxComfortableBid, ABSOLUTE_MIN_BID);
  }
  
  // ==================== OPENING BID ====================
  if (highBid === 0 || highBid < BID_MIN) {
    // Opening bid communicates hand type to partner
    let openingBid;
    
    if (isTakingHand) {
      // Signal: "I want to take this" - open at 100+
      if (handQuality === 'excellent') {
        openingBid = 100; // Very strong signal
      } else {
        openingBid = 95; // Taking hand signal
      }
      // With Rook + good hand, can open even higher
      if (hasRook && numOnes >= 1) {
        openingBid = Math.max(openingBid, 110);
      }
    } else if (isSettingHand) {
      // Signal: "I can help you" - open at 80-90
      if (hasRook || totalHighCards >= 3) {
        openingBid = 90;
      } else {
        openingBid = 80;
      }
    } else {
      // Weak hand - signal intention to fold with low bid
      // Open at 50-70 to let partner know we're weak
      if (totalHighCards >= 1) {
        openingBid = 60; // Slightly better than worst
      } else {
        openingBid = 50; // Minimum - planning to fold
      }
    }
    
    console.log(`[BOT_AI] Opening bid: ${openingBid} (taking=${isTakingHand}, setting=${isSettingHand})`);
    return { action: 'bid', amount: openingBid };
  }
  
  // ==================== RESPONDING TO EXISTING BID ====================
  const minBid = highBid + BID_INCREMENT;
  
  // CRITICAL RULE 1: Never let opponent win for less than 125
  if (opponentHasBid && highBid < ABSOLUTE_MIN_BID) {
    // Jump bid to show strength if we have a taking hand
    let targetBid;
    if (isTakingHand && highBid < 100) {
      // Jump to 100 or 125 to take control
      targetBid = highBid < 95 ? 100 : 125;
      console.log(`[BOT_AI] Taking hand - jumping to ${targetBid} to take control`);
    } else if (highBid < 120) {
      // Keep pushing opponent up
      targetBid = Math.min(minBid + 10, 125); // Jump by 10-15 to speed things up
    } else {
      targetBid = minBid;
    }
    return { action: 'bid', amount: Math.min(targetBid, maxComfortableBid) };
  }
  
  // CRITICAL RULE 2: If partner folded, must push to at least 120
  if (partnerPassed && highBid < PARTNER_FOLDED_MIN) {
    // We're alone - be aggressive
    let targetBid;
    if (isTakingHand && highBid < 100) {
      targetBid = 100; // Signal we can take it
    } else {
      targetBid = Math.min(minBid + 10, PARTNER_FOLDED_MIN);
    }
    console.log(`[BOT_AI] Partner folded - pushing to ${targetBid}`);
    return { action: 'bid', amount: targetBid };
  }
  
  // Partner has bid and signaled strong (100+) - let them take it unless we're stronger
  if (partnerBid && partnerSignaledStrong) {
    if (isTakingHand && handQuality === 'excellent') {
      // We're very strong too - keep bidding to show we can take it
      console.log(`[BOT_AI] Partner signaled strong, but we're excellent - competing`);
      // Jump to show our strength
      const jumpBid = highBid < 120 ? 125 : minBid;
      if (jumpBid <= maxComfortableBid) {
        return { action: 'bid', amount: jumpBid };
      }
    }
    // Let partner take it
    console.log(`[BOT_AI] Partner signaled strong (${highBid}) - letting them take it`);
    return { action: 'pass', amount: null };
  }
  
  // Partner bid 80-90 (helper hand) - if we have taking hand, step up
  if (partnerBid && partnerSignaledHelper && isTakingHand) {
    // Partner says they can help - we should take the bid
    const jumpBid = highBid < 95 ? 100 : (highBid < 120 ? 125 : minBid);
    if (jumpBid <= maxComfortableBid) {
      console.log(`[BOT_AI] Partner signaled helper, we have taking hand - jumping to ${jumpBid}`);
      return { action: 'bid', amount: jumpBid };
    }
  }
  
  // Check if we can/should continue bidding
  if (minBid > maxComfortableBid) {
    console.log(`[BOT_AI] Min bid ${minBid} exceeds max comfortable ${maxComfortableBid}, passing`);
    return { action: 'pass', amount: null };
  }
  
  // We're not at thresholds - decide based on hand strength and headroom
  const headroom = maxComfortableBid - minBid;
  
  // Taking hand - be aggressive with jumps
  if (isTakingHand) {
    let targetBid;
    if (highBid < 95 && headroom >= 30) {
      targetBid = 100; // Jump to signal taking hand
    } else if (highBid < 120 && headroom >= 20) {
      targetBid = 125; // Jump to 125 with strong hand
    } else {
      targetBid = minBid;
    }
    console.log(`[BOT_AI] Taking hand, bidding ${targetBid} (headroom: ${headroom})`);
    return { action: 'bid', amount: targetBid };
  }
  
  // Setting hand - be more conservative, support partner
  if (isSettingHand) {
    if (headroom >= 15) {
      console.log(`[BOT_AI] Setting hand, modest bid: ${minBid}`);
      return { action: 'bid', amount: minBid };
    } else {
      console.log(`[BOT_AI] Setting hand, limited headroom - passing`);
      return { action: 'pass', amount: null };
    }
  }
  
  // Weak hand - only continue if we must for thresholds
  if (isWeakHand) {
    // Already handled threshold cases above - if we're here, pass
    console.log(`[BOT_AI] Weak hand, passing`);
    return { action: 'pass', amount: null };
  }
  
  // Default: continue if we have room
  if (headroom >= 10) {
    console.log(`[BOT_AI] Default bid: ${minBid}`);
    return { action: 'bid', amount: minBid };
  }
  
  console.log('[BOT_AI] Default pass');
  return { action: 'pass', amount: null };
}

/**
 * Choose trump suit based on hand strength
 * 
 * Strategy:
 * 1. Choose the suit with the most cards (long trump is powerful)
 * 2. Prioritize suits where you have high cards (1s, 14s)
 * 3. Consider point card density
 * 4. A longer suit can compensate for missing some top cards
 * 
 * @param {Array<string>} hand - Player's hand after receiving kitty (18 cards)
 * @returns {string} Trump suit ('Red', 'Green', 'Yellow', or 'Black')
 */
function chooseTrump(hand) {
  const suits = ['Red', 'Green', 'Yellow', 'Black'];
  
  // Detailed analysis for each suit
  const suitAnalysis = suits.map(suit => {
    const suitCards = hand.filter(card => getCardSuit(card) === suit);
    const count = suitCards.length;
    
    // Check for key high cards
    const has1 = suitCards.some(card => getCardRank(card) === 1);
    const has14 = suitCards.some(card => getCardRank(card) === 14);
    const has13 = suitCards.some(card => getCardRank(card) === 13);
    const has12 = suitCards.some(card => getCardRank(card) === 12);
    
    // Count point cards in this suit
    const pointCards = suitCards.filter(isPointCard);
    const points = pointCards.reduce((sum, card) => sum + getCardPointValue(card), 0);
    
    // Calculate trump strength score
    // Suit length is most important (each card = 15 points)
    // Having the 1 is huge (25 points) - controls the suit
    // Having the 14 is valuable (15 points)
    // Having 13, 12 adds some value (5 points each)
    // Point cards add value too
    let score = count * 15;
    if (has1) score += 25;
    if (has14) score += 15;
    if (has13) score += 5;
    if (has12) score += 5;
    score += points * 0.5;
    
    return { suit, count, has1, has14, has13, has12, points, score };
  });
  
  // Sort by score (highest first)
  suitAnalysis.sort((a, b) => b.score - a.score);
  
  console.log('[BOT_AI] Trump selection analysis:');
  suitAnalysis.forEach(s => {
    console.log(`  ${s.suit}: ${s.count} cards, score=${s.score.toFixed(0)}, ` +
                `has1=${s.has1}, has14=${s.has14}, points=${s.points}`);
  });
  
  const chosen = suitAnalysis[0].suit;
  console.log(`[BOT_AI] Chose trump: ${chosen}`);
  
  return chosen;
}

/**
 * Analyze hand for discard decisions
 * Groups cards by suit and identifies vulnerable/safe cards
 */
function analyzeHandForDiscard(hand, trump) {
  const suits = ['Red', 'Green', 'Yellow', 'Black'];
  const analysis = {};
  
  for (const suit of suits) {
    const suitCards = hand.filter(card => getCardSuit(card) === suit);
    const isTrump = suit === trump;
    
    // Check for key cards
    const has1 = suitCards.some(card => getCardRank(card) === 1);
    const has14 = suitCards.some(card => getCardRank(card) === 14);
    
    // Identify point cards in this suit
    const pointCards = suitCards.filter(isPointCard);
    const nonPointCards = suitCards.filter(card => !isPointCard(card));
    
    // Sort cards by "keep priority" (higher = keep)
    // 1s are highest, then 14s, then other point cards, then by rank
    const sortedByPriority = [...suitCards].sort((a, b) => {
      const rankA = getCardRank(a);
      const rankB = getCardRank(b);
      const pointsA = getCardPointValue(a);
      const pointsB = getCardPointValue(b);
      
      // 1s are most valuable (trick winners)
      if (rankA === 1) return -1;
      if (rankB === 1) return 1;
      // 14s are second (trick winners + points)
      if (rankA === 14) return -1;
      if (rankB === 14) return 1;
      // Then by points
      if (pointsA !== pointsB) return pointsB - pointsA;
      // Then by rank
      return rankB - rankA;
    });
    
    analysis[suit] = {
      cards: suitCards,
      count: suitCards.length,
      isTrump,
      has1,
      has14,
      pointCards,
      nonPointCards,
      sortedByPriority,
      // Can we void this suit? (beneficial for non-trump)
      canVoid: !isTrump && suitCards.length <= 5,
      // Is this suit vulnerable? (has points but no 1 to protect them)
      isVulnerable: !isTrump && !has1 && pointCards.length > 0,
    };
  }
  
  // Handle Rook separately
  const hasRook = hand.includes('Rook');
  
  return { suits: analysis, hasRook };
}

/**
 * Choose which 5 cards to discard
 * 
 * Strategy:
 * 1. NEVER discard the Rook
 * 2. Try to void weak suits (where you don't have the 1)
 * 3. Discard vulnerable point cards (isolated 5s, 10s, 14s without protection)
 * 4. Keep off-suit 1s (they win tricks on their own)
 * 5. Minimize trump discards - only discard low trump if necessary
 * 6. Discard low-ranking off-suit cards
 * 
 * @param {Array<string>} hand - Player's hand with kitty (18 cards)
 * @param {string} trump - Chosen trump suit
 * @returns {Array<string>} Array of 5 cards to discard
 */
function chooseDiscard(hand, trump) {
  const DISCARD_COUNT = 5;
  const { suits: suitAnalysis, hasRook } = analyzeHandForDiscard(hand, trump);
  
  console.log('[BOT_AI] Discard analysis:');
  for (const [suit, info] of Object.entries(suitAnalysis)) {
    console.log(`  ${suit}: ${info.count} cards, isTrump=${info.isTrump}, ` +
                `has1=${info.has1}, canVoid=${info.canVoid}, vulnerable=${info.isVulnerable}`);
  }
  
  const discardCandidates = [];
  const mustKeep = []; // Cards we should definitely keep
  
  // RULE: Never discard the Rook
  if (hasRook) {
    mustKeep.push('Rook');
  }
  
  // RULE: Keep all off-suit 1s (they win tricks on their own)
  for (const [suit, info] of Object.entries(suitAnalysis)) {
    if (!info.isTrump && info.has1) {
      const ace = info.cards.find(card => getCardRank(card) === 1);
      if (ace) mustKeep.push(ace);
    }
  }
  
  // RULE: Keep all trump cards (prioritize keeping these)
  const trumpInfo = suitAnalysis[trump];
  if (trumpInfo) {
    mustKeep.push(...trumpInfo.cards);
  }
  
  // Identify suits to void (non-trump suits where we don't have the 1)
  const suitsToVoid = [];
  for (const [suit, info] of Object.entries(suitAnalysis)) {
    if (!info.isTrump && !info.has1 && info.count > 0 && info.count <= 4) {
      // Good candidate for voiding
      suitsToVoid.push({ suit, ...info });
    }
  }
  
  // Sort suits to void by: fewest cards first, then by least points
  suitsToVoid.sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count;
    const pointsA = a.pointCards.reduce((sum, c) => sum + getCardPointValue(c), 0);
    const pointsB = b.pointCards.reduce((sum, c) => sum + getCardPointValue(c), 0);
    return pointsA - pointsB;
  });
  
  console.log('[BOT_AI] Suits to consider voiding:', suitsToVoid.map(s => `${s.suit}(${s.count})`).join(', '));
  
  // Build discard list - prioritize voiding suits
  for (const suitInfo of suitsToVoid) {
    for (const card of suitInfo.cards) {
      if (!mustKeep.includes(card) && !discardCandidates.includes(card)) {
        discardCandidates.push(card);
      }
    }
    
    // Stop if we have enough
    if (discardCandidates.length >= DISCARD_COUNT) break;
  }
  
  // If we still need more discards, add other off-suit cards (lowest first)
  if (discardCandidates.length < DISCARD_COUNT) {
    const otherOffSuit = [];
    for (const [suit, info] of Object.entries(suitAnalysis)) {
      if (!info.isTrump) {
        for (const card of info.cards) {
          if (!mustKeep.includes(card) && !discardCandidates.includes(card)) {
            otherOffSuit.push(card);
          }
        }
      }
    }
    
    // Sort by discard priority (low cards first, avoid point cards if protected)
    otherOffSuit.sort((a, b) => {
      const suitA = getCardSuit(a);
      const suitB = getCardSuit(b);
      const rankA = getCardRank(a);
      const rankB = getCardRank(b);
      const pointsA = getCardPointValue(a);
      const pointsB = getCardPointValue(b);
      
      // If one is a vulnerable point card (no 1 in suit), prefer discarding it
      const vulnA = !suitAnalysis[suitA]?.has1 && pointsA > 0;
      const vulnB = !suitAnalysis[suitB]?.has1 && pointsB > 0;
      
      // Vulnerable point cards should be discarded (they'll be lost to opponents anyway)
      // But only if they're isolated (few cards in suit)
      if (vulnA && !vulnB && suitAnalysis[suitA]?.count <= 2) return -1;
      if (vulnB && !vulnA && suitAnalysis[suitB]?.count <= 2) return 1;
      
      // Otherwise, prefer discarding low non-point cards
      if (pointsA === 0 && pointsB > 0) return -1;
      if (pointsB === 0 && pointsA > 0) return 1;
      
      // Among non-point cards, discard lowest rank first
      return rankA - rankB;
    });
    
    for (const card of otherOffSuit) {
      if (discardCandidates.length >= DISCARD_COUNT) break;
      discardCandidates.push(card);
    }
  }
  
  // If we STILL need more (rare), discard lowest trump cards
  if (discardCandidates.length < DISCARD_COUNT && trumpInfo) {
    const lowTrump = [...trumpInfo.cards]
      .filter(card => !discardCandidates.includes(card))
      .sort((a, b) => {
        const rankA = getCardRank(a);
        const rankB = getCardRank(b);
        // Keep 1s and 14s, discard low cards first
        if (rankA === 1) return 1;
        if (rankB === 1) return -1;
        if (rankA === 14) return 1;
        if (rankB === 14) return -1;
        return rankA - rankB; // Lowest first
      });
    
    for (const card of lowTrump) {
      if (discardCandidates.length >= DISCARD_COUNT) break;
      // Make sure we keep at least 1 trump card
      const remainingTrump = trumpInfo.cards.filter(c => 
        !discardCandidates.includes(c) && c !== card
      );
      if (remainingTrump.length >= 1) {
        discardCandidates.push(card);
      }
    }
  }
  
  // Final safety: if we still don't have enough, take any non-Rook card
  if (discardCandidates.length < DISCARD_COUNT) {
    for (const card of hand) {
      if (card === 'Rook') continue; // Never discard Rook
      if (discardCandidates.includes(card)) continue;
      discardCandidates.push(card);
      if (discardCandidates.length >= DISCARD_COUNT) break;
    }
  }
  
  const finalDiscards = discardCandidates.slice(0, DISCARD_COUNT);
  
  console.log('[BOT_AI] Final discards:', finalDiscards.join(', '));
  
  // Verify we're not discarding all trump
  const trumpRemaining = trumpInfo?.cards.filter(c => !finalDiscards.includes(c)) || [];
  if (trumpRemaining.length === 0) {
    console.warn('[BOT_AI] WARNING: Would discard all trump! Adjusting...');
    // Swap last discard with a trump card
    if (trumpInfo && trumpInfo.cards.length > 0) {
      const trumpToKeep = trumpInfo.cards[0];
      const lastDiscard = finalDiscards.pop();
      if (lastDiscard && lastDiscard !== 'Rook') {
        finalDiscards.push(trumpToKeep);
        // Find a replacement - any non-trump, non-Rook card not in discards
        for (const card of hand) {
          if (card === 'Rook') continue;
          if (getCardSuit(card) === trump) continue;
          if (finalDiscards.includes(card)) continue;
          finalDiscards.push(card);
          break;
        }
      }
    }
  }
  
  // Verify we're not discarding the Rook
  if (finalDiscards.includes('Rook')) {
    console.error('[BOT_AI] ERROR: Attempting to discard Rook! Removing...');
    const rookIndex = finalDiscards.indexOf('Rook');
    finalDiscards.splice(rookIndex, 1);
    // Find a replacement
    for (const card of hand) {
      if (card === 'Rook') continue;
      if (finalDiscards.includes(card)) continue;
      finalDiscards.push(card);
      break;
    }
  }
  
  return finalDiscards.slice(0, DISCARD_COUNT);
}

/**
 * Choose which card to play - comprehensive trick-playing strategy
 * 
 * Strategy overview:
 * 1. Follow suit if possible (mandatory)
 * 2. When teammate winning: feed points or play low
 * 3. When opponent winning: try to win valuable tricks, else slough
 * 4. When void: trump strategically or slough low cards
 * 5. Consider position (last to play has perfect info)
 * 6. Offensive (bidder): pull trump early
 * 7. Defensive (setting): avoid leading trump, force opponents to use theirs
 * 
 * @param {Array<string>} hand - Player's hand
 * @param {string} trump - Trump suit
 * @param {Array<object>} currentTrick - Current trick [{ seat, card }, ...]
 * @param {string|null} ledSuit - Led suit (null if leading)
 * @param {object} teams - Teams object { team0: [seats], team1: [seats] }
 * @param {number} mySeat - Bot's seat
 * @param {object} gameContext - Additional context { bidWinner, myTeamBid, cardsPlayed, tricksRemaining }
 * @returns {string} Card to play
 */
function chooseCardToPlay(hand, trump, currentTrick, ledSuit, teams, mySeat, gameContext = {}) {
  const validPlays = getValidPlays(hand, ledSuit, trump);

  if (validPlays.length === 0) {
    console.warn('[BOT_AI] No valid plays - fallback to first card');
    return hand[0];
  }

  if (validPlays.length === 1) {
    return validPlays[0];
  }

  // Determine my team and partner
  const myTeam = teams.team0.includes(mySeat) ? 'team0' : 'team1';
  const partnerSeat = teams[myTeam].find(s => s !== mySeat);
  
  // Am I on the bidding team? (offensive vs defensive play)
  const { bidWinner } = gameContext;
  const isOffensive = bidWinner !== undefined && teams[myTeam].includes(bidWinner);
  
  // Leading the trick
  if (currentTrick.length === 0) {
    return chooseLeadCard(hand, trump, isOffensive, gameContext);
  }

  // Following - analyze the current trick state
  const trickCards = currentTrick.map(t => t.card);
  const position = currentTrick.length; // 0=lead, 1=2nd, 2=3rd, 3=last
  const isLastToPlay = position === 3;
  
  // Determine current winner
  let currentWinner = currentTrick[0].seat;
  let winningCard = currentTrick[0].card;
  let winningValue = getCardPlayValue(currentTrick[0].card, trump, ledSuit);

  for (let i = 1; i < currentTrick.length; i++) {
    const value = getCardPlayValue(currentTrick[i].card, trump, ledSuit);
    if (value > winningValue) {
      winningValue = value;
      currentWinner = currentTrick[i].seat;
      winningCard = currentTrick[i].card;
    }
  }

  const isPartnerWinning = currentWinner === partnerSeat;
  const isTeammateWinning = teams[myTeam].includes(currentWinner);
  const isOpponentWinning = !isTeammateWinning;

  // Calculate point value of current trick
  const trickPoints = trickCards.reduce((sum, card) => sum + getCardPointValue(card), 0);
  
  // Check if we're following suit or void
  const canFollowSuit = validPlays.some(card => getCardSuit(card) === ledSuit);
  const isVoid = !canFollowSuit && ledSuit !== null;
  
  // Categorize valid plays
  const trumpPlays = validPlays.filter(card => getCardSuit(card) === trump || card === 'Rook');
  const pointPlays = validPlays.filter(isPointCard);
  const nonPointPlays = validPlays.filter(card => !isPointCard(card));
  
  console.log(`[BOT_AI] Trick analysis: position=${position}, partnerWinning=${isPartnerWinning}, ` +
              `trickPoints=${trickPoints}, isVoid=${isVoid}, offensive=${isOffensive}`);

  // ==================== TEAMMATE/PARTNER IS WINNING ====================
  if (isTeammateWinning) {
    // Partner is winning - DO NOT overtake! Instead:
    // 1. Feed point cards to partner (dump points on winning trick)
    // 2. Or play lowest card to save high cards for later
    
    // Get cardsPlayed from gameContext
    const { cardsPlayed = [] } = gameContext;
    
    // Check if partner led the trick
    const partnerLed = currentTrick.length > 0 && currentTrick[0].seat === partnerSeat;
    const partnerLedCard = partnerLed ? currentTrick[0].card : null;
    const partnerLedRank = partnerLedCard ? getCardRank(partnerLedCard) : null;
    const partnerLedSuit = partnerLedCard ? getCardSuit(partnerLedCard) : null;
    
    // Determine if partner has the highest card left (for Rook feeding)
    // Partner has highest trump if: they're winning with trump and no higher trump has been played
    let partnerHasHighestTrump = false;
    if (isPartnerWinning && winningCard) {
      const partnerCardSuit = getCardSuit(winningCard);
      if (partnerCardSuit === trump || winningCard === 'Rook') {
        // Partner is winning with trump - check if any higher trump has been played
        const partnerCardRank = winningCard === 'Rook' ? 0 : getCardRank(winningCard);
        // Check if any trump higher than partner's has been played
        const higherTrumpsPlayed = cardsPlayed.filter(card => {
          if (card === 'Rook') return false; // Rook is lowest
          const suit = getCardSuit(card);
          const rank = getCardRank(card);
          return suit === trump && rank > partnerCardRank;
        });
        partnerHasHighestTrump = higherTrumpsPlayed.length === 0;
      }
    }
    
    // Check if we can safely feed partner points
    // Feed when: partner is winning AND (we're last OR partner has highest card of that suit)
    const canFeedPartner = isPartnerWinning && (
      isLastToPlay || 
      (partnerLed && partnerLedSuit && partnerLedSuit !== trump && 
       // Check if partner has the highest card of that suit (1 or highest remaining)
       (partnerLedRank === 1 || !hasCardBeenPlayed(`${partnerLedSuit}1`, cardsPlayed)))
    );
    
    if (canFeedPartner) {
      // Look for point cards we can safely dump
      const safePointsToFeed = pointPlays.filter(card => {
        const suit = getCardSuit(card);
        const rank = getCardRank(card);
        
        // Don't feed cards that would beat partner's winning card
        const cardValue = getCardPlayValue(card, trump, ledSuit);
        if (cardValue > winningValue) {
          return false; // Would overtake partner
        }
        
        // Can feed Rook if partner has highest trump or we're last (check BEFORE off-suit check)
        if (card === 'Rook') {
          return partnerHasHighestTrump || isLastToPlay;
        }
        
        // Don't feed 14s if partner has 1 (don't feed 14s to 1s)
        const winningCardSuit = getCardSuit(winningCard);
        const winningCardRank = getCardRank(winningCard);
        if (winningCardRank === 1 && rank === 14 && suit === winningCardSuit && suit !== trump) {
          return false;
        }
        
        // Safe to feed: off-suit point cards
        if (suit !== trump && suit !== ledSuit) return true;
        
        // Can feed trump points if partner has highest trump
        if (suit === trump && partnerHasHighestTrump) return true;
        
        return true;
      });
      
      if (safePointsToFeed.length > 0) {
        // Feed the highest point card we can (maximize points for our team)
        const sorted = safePointsToFeed.sort((a, b) => 
          getCardPointValue(b) - getCardPointValue(a)
        );
        console.log(`[BOT_AI] Feeding partner: ${sorted[0]}`);
        return sorted[0];
      }
    }
    
    // Not last, or no points to feed - just play low
    // But consider partner's lead strategy:
    // - If partner led high (13+), play lower (trust partner)
    // - If partner led low, play high if we have strength
    
    let safePlays = validPlays;
    
    // Partner leading strategy: adjust play based on what partner led
    if (partnerLed && canFollowSuit && partnerLedSuit === ledSuit) {
      // Partner led this suit - adjust our play
      const ourCardsInSuit = validPlays.filter(card => getCardSuit(card) === ledSuit);
      
      if (ourCardsInSuit.length > 0) {
        if (partnerLedRank >= 13) {
          // Partner led high (13 or 14) - trust them, play lower
          // Find our lowest card in suit (but not 14 if 1 hasn't been played)
          const aceOfLedSuit = `${ledSuit}1`;
          const aceHasBeenPlayed = hasCardBeenPlayed(aceOfLedSuit, cardsPlayed);
          
          let lowCards = ourCardsInSuit;
          if (!aceHasBeenPlayed) {
            // Don't play 14 if 1 hasn't been played
            lowCards = ourCardsInSuit.filter(card => getCardRank(card) !== 14);
            if (lowCards.length === 0) lowCards = ourCardsInSuit; // Fallback
          }
          
          const sortedLow = sortCardsByValue(lowCards, trump, ledSuit, true); // Ascending
          console.log(`[BOT_AI] Partner led high (${partnerLedRank}) - playing low: ${sortedLow[0]}`);
          return sortedLow[0];
        } else if (partnerLedRank <= 5 && partnerLedRank !== 1) {
          // Partner led low (but not 1, since 1 is high) - play high if we have strength
          const highCards = ourCardsInSuit.filter(card => {
            const rank = getCardRank(card);
            return rank >= 12; // 12, 13, 14, or 1
          });
          
          if (highCards.length > 0) {
            // Play highest card we have (but not 14 if 1 hasn't been played)
            const aceOfLedSuit = `${ledSuit}1`;
            const aceHasBeenPlayed = hasCardBeenPlayed(aceOfLedSuit, cardsPlayed);
            
            let safeHighCards = highCards;
            if (!aceHasBeenPlayed) {
              safeHighCards = highCards.filter(card => getCardRank(card) !== 14);
              if (safeHighCards.length === 0) safeHighCards = highCards; // Fallback
            }
            
            const sortedHigh = sortCardsByValue(safeHighCards, trump, ledSuit, false); // Descending
            console.log(`[BOT_AI] Partner led low (${partnerLedRank}) - playing high: ${sortedHigh[0]}`);
            return sortedHigh[0];
          }
        }
      }
    }
    
    // Filter out 14s if the 1 hasn't been played yet (unless we're last to play)
    if (!isLastToPlay && ledSuit && ledSuit !== trump) {
      // Check if 1 of led suit has been played
      const aceOfLedSuit = `${ledSuit}1`;
      const aceHasBeenPlayed = hasCardBeenPlayed(aceOfLedSuit, cardsPlayed);
      
      if (!aceHasBeenPlayed) {
        // Don't play 14 if 1 hasn't been played
        safePlays = validPlays.filter(card => {
          const suit = getCardSuit(card);
          const rank = getCardRank(card);
          // Filter out 14s of the led suit
          return !(suit === ledSuit && rank === 14);
        });
        
        // If we filtered out all valid plays, fall back to original
        if (safePlays.length === 0) {
          safePlays = validPlays;
        }
      }
    }
    
    const sorted = sortCardsByValue(safePlays, trump, ledSuit, true); // Ascending
    
    // Prefer non-trump low cards if void
    if (isVoid && nonPointPlays.length > 0) {
      const nonTrumpNonPoint = nonPointPlays.filter(c => getCardSuit(c) !== trump && c !== 'Rook');
      if (nonTrumpNonPoint.length > 0) {
        return nonTrumpNonPoint.sort((a, b) => getCardRank(a) - getCardRank(b))[0];
      }
    }
    
    // CRITICAL: Never play the Rook when playing low for a teammate
    // The Rook is worth 20 points - find any other card first
    const safeLowest = sorted.find(c => c !== 'Rook');
    if (safeLowest) {
      console.log(`[BOT_AI] Partner winning - playing low (avoiding Rook): ${safeLowest}`);
      return safeLowest;
    }
    
    // Only play Rook as absolute last resort (no other valid plays)
    console.log(`[BOT_AI] Partner winning - forced to play Rook (only option): ${sorted[0]}`);
    return sorted[0];
  }

  // ==================== OPPONENT IS WINNING ====================
  // Decide whether to try to win or slough
  
  // Get cardsPlayed from gameContext
  const { cardsPlayed = [] } = gameContext;
  
  // Calculate if we CAN win
  let winningPlays = validPlays.filter(card => {
    const value = getCardPlayValue(card, trump, ledSuit);
    return value > winningValue;
  });
  
  // Filter out 14s if the 1 hasn't been played yet (unless we're last to play)
  if (!isLastToPlay && ledSuit && ledSuit !== trump) {
    const aceOfLedSuit = `${ledSuit}1`;
    const aceHasBeenPlayed = hasCardBeenPlayed(aceOfLedSuit, cardsPlayed);
    
    if (!aceHasBeenPlayed) {
      // Don't play 14 if 1 hasn't been played - filter it out from winning plays
      winningPlays = winningPlays.filter(card => {
        const suit = getCardSuit(card);
        const rank = getCardRank(card);
        return !(suit === ledSuit && rank === 14);
      });
    }
  }
  
  const canWin = winningPlays.length > 0;
  
  // Decision factors for whether to TRY to win:
  // - Trick value (more points = more important to win)
  // - Position (last to play = we know for sure if we win)
  // - Cost (what card do we have to spend to win?)
  // - Score situation (need points? or trying to set?)
  
  const shouldTryToWin = (trickPoints >= 10) || // Valuable trick
                         (isLastToPlay && trickPoints >= 5) || // Last to play, even small value matters
                         (isOffensive && trickPoints >= 5); // Offensive - need every point
  
  if (canWin && shouldTryToWin) {
    // Find the CHEAPEST winning card
    const sortedWinners = winningPlays.sort((a, b) => {
      const valueA = getCardPlayValue(a, trump, ledSuit);
      const valueB = getCardPlayValue(b, trump, ledSuit);
      return valueA - valueB; // Lowest winning card first
    });
    
    const cheapestWinner = sortedWinners[0];
    const cheapestWinnerValue = getCardPlayValue(cheapestWinner, trump, ledSuit);
    
    // Check if the cost is worth it
    // Don't waste trump on low-value tricks unless necessary
    const isTrumpCard = getCardSuit(cheapestWinner) === trump || cheapestWinner === 'Rook';
    const is1Card = getCardRank(cheapestWinner) === 1;
    
    if (isTrumpCard && trickPoints < 10 && !isLastToPlay) {
      // Don't waste trump on low-value trick unless we're last
      console.log(`[BOT_AI] Not worth trumping for ${trickPoints} points`);
    } else if (is1Card && trickPoints < 15 && !isLastToPlay) {
      // Don't waste a 1 (ace) on low-value trick
      console.log(`[BOT_AI] Saving ace for better opportunity`);
    } else {
      console.log(`[BOT_AI] Winning with: ${cheapestWinner}`);
      return cheapestWinner;
    }
  }
  
  // Also filter 14s from slough candidates if 1 hasn't been played
  let safeSloughCandidates = validPlays;
  if (!isLastToPlay && ledSuit && ledSuit !== trump) {
    const aceOfLedSuit = `${ledSuit}1`;
    const aceHasBeenPlayed = hasCardBeenPlayed(aceOfLedSuit, cardsPlayed);
    
    if (!aceHasBeenPlayed) {
      // Don't slough 14 if 1 hasn't been played
      safeSloughCandidates = validPlays.filter(card => {
        const suit = getCardSuit(card);
        const rank = getCardRank(card);
        return !(suit === ledSuit && rank === 14);
      });
      
      // If we filtered out all valid plays, fall back to original
      if (safeSloughCandidates.length === 0) {
        safeSloughCandidates = validPlays;
      }
    }
  }
  
  // Can't win or not worth it - slough a card
  // NEVER slough big point cards to opponents!
  
  // Find safest card to slough (using safeSloughCandidates which excludes 14s if 1 hasn't been played)
  const sloughCandidates = safeSloughCandidates.filter(card => {
    const points = getCardPointValue(card);
    // Avoid sloughing Rook or big points to opponents
    if (card === 'Rook') return false;
    if (points >= 10) return false; // Don't give 10+ points to opponents
    if (points >= 5 && trickPoints >= 10) return false; // Don't add 5 to already valuable trick
    return true;
  });
  
  if (sloughCandidates.length > 0) {
    // Slough lowest value card
    const sorted = sloughCandidates.sort((a, b) => {
      // Prefer non-trump, non-point, low rank
      const suitA = getCardSuit(a);
      const suitB = getCardSuit(b);
      const isTrumpA = suitA === trump;
      const isTrumpB = suitB === trump;
      
      // Non-trump first
      if (!isTrumpA && isTrumpB) return -1;
      if (isTrumpA && !isTrumpB) return 1;
      
      // Then by rank (low first)
      return getCardRank(a) - getCardRank(b);
    });
    console.log(`[BOT_AI] Sloughing: ${sorted[0]}`);
    return sorted[0];
  }
  
  // No good slough options - forced to play something
  // Play lowest value card we have, but NEVER give away the Rook to opponents
  const allSorted = [...validPlays].sort((a, b) => {
    // Sort by: non-point first, then low rank
    const pointsA = getCardPointValue(a);
    const pointsB = getCardPointValue(b);
    if (pointsA !== pointsB) return pointsA - pointsB;
    return getCardRank(a) - getCardRank(b);
  });
  
  // CRITICAL: Avoid giving Rook (20 points!) to opponents
  // Find any card that isn't the Rook
  const safeForced = allSorted.find(c => c !== 'Rook');
  if (safeForced) {
    console.log(`[BOT_AI] Forced play (avoiding Rook): ${safeForced}`);
    return safeForced;
  }
  
  // Only play Rook as absolute last resort (no other valid plays)
  console.log(`[BOT_AI] Forced play - only Rook available: ${allSorted[0]}`);
  return allSorted[0];
}

/**
 * Choose card to lead - comprehensive leading strategy
 * 
 * Offensive (bidding team):
 * - Pull trump early to remove opponent's trump
 * - Lead high trump to flush out opponent's trump
 * - Then lead guaranteed winners (aces in other suits)
 * 
 * Defensive (setting team):
 * - Don't lead trump (helps bidder)
 * - Lead suits where you have the 1 (guaranteed win)
 * - Force opponents to use their trump
 * 
 * @param {Array<string>} hand - Player's hand
 * @param {string} trump - Trump suit
 * @param {boolean} isOffensive - True if bot's team won the bid
 * @param {object} gameContext - Additional context
 * @returns {string} Card to lead
 */
function chooseLeadCard(hand, trump, isOffensive = true, gameContext = {}) {
  const suits = ['Red', 'Green', 'Yellow', 'Black'];
  
  // Analyze hand by suit
  const suitInfo = {};
  for (const suit of suits) {
    const cards = hand.filter(card => getCardSuit(card) === suit);
    const has1 = cards.some(c => getCardRank(c) === 1);
    const has14 = cards.some(c => getCardRank(c) === 14);
    const highestRank = cards.length > 0 ? Math.max(...cards.map(getCardRank)) : 0;
    suitInfo[suit] = { cards, count: cards.length, has1, has14, highestRank };
  }
  
  const trumpCards = hand.filter(card => getCardSuit(card) === trump);
  const hasRook = hand.includes('Rook');
  const trumpInfo = suitInfo[trump];
  
  console.log(`[BOT_AI] Lead decision: offensive=${isOffensive}, trump=${trump}, ` +
              `trumpCount=${trumpCards.length}, hasRook=${hasRook}`);

  // ==================== OFFENSIVE PLAY (Bidding Team) ====================
  if (isOffensive) {
    // Priority 1: Pull trump early (if we have good trump)
    // Lead trump to flush out opponents' trump
    if (trumpCards.length >= 3 || (trumpCards.length >= 2 && trumpInfo?.has1)) {
      // We have trump strength - lead trump to pull
      // Strategy: Lead 1 first when we have both 1 and 13 (in case partner has trump/points to throw)
      // Otherwise prefer non-point trump, then high point trump
      
      let trumpToLead;
      const has1 = trumpInfo?.has1;
      const has13 = trumpCards.some(c => getCardRank(c) === 13);
      const has14 = trumpCards.some(c => getCardRank(c) === 14);
      
      if (has1 && (has13 || has14)) {
        // We have both 1 and 13/14 - lead 1 first (partner might have trump/points to throw)
        const ace = trumpCards.find(c => getCardRank(c) === 1);
        trumpToLead = ace;
        console.log(`[BOT_AI] Pulling trump with 1 (have both 1 and 13/14): ${trumpToLead}`);
      } else {
        // Prefer non-point trump cards when possible
        const nonPointTrump = trumpCards.filter(card => !isPointCard(card));
        
        if (nonPointTrump.length > 0) {
          // Lead non-point trump (save point cards for later)
          const sortedNonPointTrump = nonPointTrump.sort((a, b) => {
            const rankA = getCardRank(a);
            const rankB = getCardRank(b);
            return rankB - rankA; // Descending
          });
          trumpToLead = sortedNonPointTrump[0];
        } else {
          // Only point trump available - lead highest trump (1, then 14, then others)
          const sortedTrump = trumpCards.sort((a, b) => {
            const rankA = getCardRank(a);
            const rankB = getCardRank(b);
            // Sort 1 first, then 14, then Rook last, rest descending
            if (rankA === 1) return -1;
            if (rankB === 1) return 1;
            if (rankA === 14) return -1;
            if (rankB === 14) return 1;
            if (a === 'Rook') return 1;
            if (b === 'Rook') return -1;
            return rankB - rankA;
          });
          trumpToLead = sortedTrump[0];
        }
      }
      
      if (trumpToLead) {
        console.log(`[BOT_AI] Pulling trump: ${trumpToLead}`);
        return trumpToLead;
      }
    }
    
    // Priority 2: Lead guaranteed winners (off-suit 1s) - these are safe to lead
    for (const suit of suits) {
      if (suit === trump) continue;
      if (suitInfo[suit].has1) {
        const ace = suitInfo[suit].cards.find(c => getCardRank(c) === 1);
        console.log(`[BOT_AI] Leading guaranteed winner: ${ace}`);
        return ace;
      }
    }
    
    // Priority 3: Lead non-point cards from off-suits (avoid leading point cards)
    for (const suit of suits) {
      if (suit === trump) continue;
      const nonPointCards = suitInfo[suit].cards.filter(card => !isPointCard(card));
      if (nonPointCards.length > 0) {
        // Lead highest non-point card
        const sorted = nonPointCards.sort((a, b) => getCardRank(b) - getCardRank(a));
        console.log(`[BOT_AI] Leading non-point off-suit: ${sorted[0]}`);
        return sorted[0];
      }
    }
    
    // Priority 4: If only point cards available, lead from strong off-suits (has 14 and length)
    // This is a fallback when we have no non-point alternatives
    for (const suit of suits) {
      if (suit === trump) continue;
      if (suitInfo[suit].has14 && suitInfo[suit].count >= 2) {
        const fourteen = suitInfo[suit].cards.find(c => getCardRank(c) === 14);
        console.log(`[BOT_AI] Leading strong off-suit (fallback): ${fourteen}`);
        return fourteen;
      }
    }
  }
  
  // ==================== DEFENSIVE PLAY (Setting Team) ====================
  else {
    // Priority 1: DO NOT lead trump (helps bidder pull our trump)
    
    // Priority 2: Lead suits where we have the 1 (guaranteed win) - safe to lead even though it's a point card
    for (const suit of suits) {
      if (suit === trump) continue;
      if (suitInfo[suit].has1) {
        const ace = suitInfo[suit].cards.find(c => getCardRank(c) === 1);
        console.log(`[BOT_AI] Defensive lead with ace: ${ace}`);
        return ace;
      }
    }
    
    // Priority 2.5: Lead low point cards (like 5s) to tempt opponents to waste trump
    for (const suit of suits) {
      if (suit === trump) continue;
      const pointCards = suitInfo[suit].cards.filter(card => isPointCard(card));
      // Look for low point cards (5s) that we can lead to fish out trump
      const lowPointCards = pointCards.filter(card => {
        const rank = getCardRank(card);
        return rank === 5; // Lead 5s to tempt opponents
      });
      
      if (lowPointCards.length > 0 && suitInfo[suit].count >= 2) {
        // We have 5s and multiple cards in suit - lead a 5 to tempt opponent to waste trump
        const five = lowPointCards[0];
        console.log(`[BOT_AI] Defensive lead with low point card (fishing for trump): ${five}`);
        return five;
      }
    }
    
    // Priority 3: Lead non-point cards from short suits to create voids (so we can trump later)
    const shortSuits = suits
      .filter(s => s !== trump && suitInfo[s].count > 0 && suitInfo[s].count <= 2)
      .sort((a, b) => suitInfo[a].count - suitInfo[b].count);
    
    if (shortSuits.length > 0) {
      for (const suit of shortSuits) {
        const nonPointCards = suitInfo[suit].cards.filter(card => !isPointCard(card));
        if (nonPointCards.length > 0) {
          // Lead low non-point card from short suit
          const lowCard = nonPointCards.sort((a, b) => getCardRank(a) - getCardRank(b))[0];
          console.log(`[BOT_AI] Defensive lead from short suit (non-point): ${lowCard}`);
          return lowCard;
        }
      }
      // Fallback: if only point cards in short suits, lead lowest
      const suit = shortSuits[0];
      const cards = suitInfo[suit].cards;
      const lowCard = cards.sort((a, b) => getCardRank(a) - getCardRank(b))[0];
      console.log(`[BOT_AI] Defensive lead from short suit (fallback): ${lowCard}`);
      return lowCard;
    }
    
    // Priority 4: Lead non-point low cards from long off-suits
    for (const suit of suits) {
      if (suit === trump) continue;
      if (suitInfo[suit].count >= 3) {
        const nonPointCards = suitInfo[suit].cards.filter(card => !isPointCard(card));
        if (nonPointCards.length > 0) {
          // Lead low non-point card
          const sorted = nonPointCards.sort((a, b) => getCardRank(a) - getCardRank(b));
          console.log(`[BOT_AI] Defensive lead low (non-point): ${sorted[0]}`);
          return sorted[0];
        }
      }
    }
    
    // Priority 5: Fallback - lead low cards from long off-suits (even if point cards)
    for (const suit of suits) {
      if (suit === trump) continue;
      if (suitInfo[suit].count >= 3) {
        const cards = suitInfo[suit].cards;
        // Lead low-mid card
        const sorted = cards.sort((a, b) => getCardRank(a) - getCardRank(b));
        console.log(`[BOT_AI] Defensive lead low (fallback): ${sorted[0]}`);
        return sorted[0];
      }
    }
  }
  
  // ==================== FALLBACK LOGIC ====================
  
  // Lead from longest non-trump suit, preferring non-point cards
  let longestSuit = null;
  let maxLength = 0;
  for (const suit of suits) {
    if (suit !== trump && suitInfo[suit].count > maxLength) {
      maxLength = suitInfo[suit].count;
      longestSuit = suit;
    }
  }
  
  if (longestSuit && maxLength > 0) {
    const cards = suitInfo[longestSuit].cards;
    const nonPointCards = cards.filter(card => !isPointCard(card));
    
    if (nonPointCards.length > 0) {
      // Lead mid-high non-point card
      const sorted = nonPointCards.sort((a, b) => getCardRank(b) - getCardRank(a));
      const leadIndex = Math.min(1, sorted.length - 1);
      console.log(`[BOT_AI] Fallback lead from longest suit (non-point): ${sorted[leadIndex]}`);
      return sorted[leadIndex];
    } else {
      // Fallback to point cards if no non-point available
      const sorted = cards.sort((a, b) => getCardRank(b) - getCardRank(a));
      const leadIndex = Math.min(1, sorted.length - 1);
      console.log(`[BOT_AI] Fallback lead from longest suit (fallback): ${sorted[leadIndex]}`);
      return sorted[leadIndex];
    }
  }
  
  // If only trump left, lead lowest trump (save high ones)
  if (trumpCards.length > 0) {
    const sorted = trumpCards.sort((a, b) => {
      if (a === 'Rook') return -1; // Rook is lowest, lead it first if we must
      if (b === 'Rook') return 1;
      return getCardRank(a) - getCardRank(b);
    });
    console.log(`[BOT_AI] Only trump left, leading: ${sorted[0]}`);
    return sorted[0];
  }
  
  // Last resort
  console.log(`[BOT_AI] Last resort lead: ${hand[0]}`);
  return hand[0];
}

module.exports = {
  analyzeSuit,
  evaluateHandStrength,
  decideBid,
  chooseTrump,
  chooseDiscard,
  chooseCardToPlay,
  chooseLeadCard, // Export for testing
};
