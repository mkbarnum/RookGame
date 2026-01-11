/**
 * WebSocket Integration Test
 * Tests the full game flow: create, join, bid, trump selection, play tricks, quick chat
 */

const WebSocket = require('ws');
const https = require('https');

const HTTP_API = 'https://698u4fhbeg.execute-api.us-east-1.amazonaws.com';
const WS_API = 'wss://he75v1ijt1.execute-api.us-east-1.amazonaws.com/prod';

function httpPost(path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, HTTP_API);
    const postData = JSON.stringify(data);
    
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function connectWebSocket(gameId, playerName, seat) {
  return new Promise((resolve, reject) => {
    const url = `${WS_API}?gameId=${gameId}&playerName=${encodeURIComponent(playerName)}&seat=${seat}`;
    console.log(`  Connecting: ${playerName} (seat ${seat})`);
    
    const ws = new WebSocket(url);
    const messages = [];
    let cards = [];
    
    ws.on('open', () => {
      console.log(`  ✓ ${playerName} connected`);
      resolve({ ws, messages, getCards: () => cards, setCards: (c) => cards = c });
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      
      // Store cards when dealt
      if (msg.action === 'deal' && msg.cards) {
        cards = msg.cards;
      }
      // Add kitty cards when received
      if (msg.action === 'kitty' && msg.cards) {
        cards = [...cards, ...msg.cards];
      }
      
      const preview = JSON.stringify(msg).slice(0, 60);
      console.log(`  📨 ${playerName}: ${msg.action || msg.type} - ${preview}...`);
    });
    
    ws.on('error', reject);
    
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findMessage(messages, action) {
  return messages.find(m => m.action === action);
}

function findLastMessage(messages, action) {
  return [...messages].reverse().find(m => m.action === action);
}

async function runTest() {
  console.log('\n🎮 ROOK FULL GAME INTEGRATION TEST\n');
  console.log('='.repeat(60));
  
  const players = [];
  
  try {
    // ============ STEP 1: Create game ============
    console.log('\n1️⃣  Creating game...');
    const createResp = await httpPost('/createGame', { hostName: 'Alice' });
    if (!createResp.success) {
      throw new Error(`Failed to create game: ${JSON.stringify(createResp)}`);
    }
    const gameId = createResp.gameId;
    console.log(`   ✓ Game created: ${gameId}`);
    
    // ============ STEP 2: Connect host via WebSocket ============
    console.log('\n2️⃣  Connecting host via WebSocket...');
    const alice = await connectWebSocket(gameId, 'Alice', 0);
    players.push(alice);
    
    // ============ STEP 3: Join other players ============
    console.log('\n3️⃣  Joining other players...');
    const playerNames = ['Bob', 'Charlie', 'Diana'];
    for (let i = 0; i < 3; i++) {
      const joinResp = await httpPost('/joinGame', { gameId, playerName: playerNames[i] });
      console.log(`   ✓ ${playerNames[i]} joined: seat ${joinResp.seat}`);
      await sleep(300);
    }
    
    await sleep(500);
    console.log(`   Alice received ${alice.messages.length} playerJoined messages`);
    
    // ============ STEP 4: Connect all players via WebSocket ============
    console.log('\n4️⃣  Connecting all players via WebSocket...');
    const bob = await connectWebSocket(gameId, 'Bob', 1);
    const charlie = await connectWebSocket(gameId, 'Charlie', 2);
    const diana = await connectWebSocket(gameId, 'Diana', 3);
    players.push(bob, charlie, diana);
    
    // ============ STEP 5: Start game (host selects partner) ============
    console.log('\n5️⃣  Starting game (Alice selects Bob as partner)...');
    const chooseResp = await httpPost('/choosePartner', { gameId, partnerSeat: 1 });
    
    if (chooseResp.error) {
      throw new Error(`choosePartner failed: ${chooseResp.message}`);
    }
    console.log(`   ✓ Partner selected! Status: ${chooseResp.status}`);
    console.log(`   Teams: ${JSON.stringify(chooseResp.teams)}`);
    
    await sleep(1500);
    
    // Verify all players got cards
    console.log('\n   Verifying deal...');
    for (let i = 0; i < 4; i++) {
      const p = players[i];
      const name = ['Alice', 'Bob', 'Charlie', 'Diana'][i];
      console.log(`   ${name}: ${p.getCards().length} cards`);
    }
    
    // ============ STEP 6: Complete bidding ============
    console.log('\n6️⃣  Running bidding phase...');
    
    // After seatsRearranged, seats are:
    // Alice: 0, Bob: 2 (partner), Charlie: 1, Diana: 3
    // So bidding order starting from seat 0: Alice(0) -> Charlie(1) -> Bob(2) -> Diana(3)
    
    const seatsRearranged = findMessage(alice.messages, 'seatsRearranged');
    console.log(`   Seats after rearrangement:`);
    if (seatsRearranged?.players) {
      seatsRearranged.players.forEach(p => console.log(`     ${p.name}: seat ${p.seat}`));
    }
    
    // Map players by their NEW seats
    // alice=0, charlie=1, bob=2, diana=3
    const seatToPlayer = { 0: alice, 1: charlie, 2: bob, 3: diana };
    const seatToName = { 0: 'Alice', 1: 'Charlie', 2: 'Bob', 3: 'Diana' };
    
    // Helper to wait for nextBidder message for a specific seat
    // Handles both batched (in bidPlaced/playerPassed) and separate messages
    async function waitForNextBidder(player, expectedSeat, timeout = 5000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        // Check for separate nextBidder message
        const nextBidderMsg = findLastMessage(player.messages, 'nextBidder');
        if (nextBidderMsg && nextBidderMsg.seat === expectedSeat) {
          return true;
        }
        // Check for batched nextBidder in bidPlaced or playerPassed
        const bidPlacedMsg = findLastMessage(player.messages, 'bidPlaced');
        if (bidPlacedMsg && bidPlacedMsg.nextBidder === expectedSeat) {
          return true;
        }
        const playerPassedMsg = findLastMessage(player.messages, 'playerPassed');
        if (playerPassedMsg && playerPassedMsg.nextBidder === expectedSeat) {
          return true;
        }
        await sleep(100);
      }
      return false;
    }
    
    // Alice bids 50
    console.log(`   Alice (seat 0) bids 50...`);
    alice.ws.send(JSON.stringify({ action: 'bid', amount: 50 }));
    
    // Wait for nextBidder to be seat 1 (Charlie)
    if (!await waitForNextBidder(alice, 1)) {
      console.log('   ⚠️  Timeout waiting for nextBidder seat 1');
    }
    
    // Charlie (seat 1) passes
    console.log(`   Charlie (seat 1) passes...`);
    charlie.ws.send(JSON.stringify({ action: 'pass' }));
    
    // Wait for nextBidder to be seat 2 (Bob)
    if (!await waitForNextBidder(alice, 2)) {
      console.log('   ⚠️  Timeout waiting for nextBidder seat 2');
    }
    
    // Bob (seat 2) passes
    console.log(`   Bob (seat 2) passes...`);
    bob.ws.send(JSON.stringify({ action: 'pass' }));
    
    // Wait for nextBidder to be seat 3 (Diana)
    if (!await waitForNextBidder(alice, 3)) {
      console.log('   ⚠️  Timeout waiting for nextBidder seat 3');
    }
    
    // Diana (seat 3) passes - this should end bidding
    console.log(`   Diana (seat 3) passes...`);
    diana.ws.send(JSON.stringify({ action: 'pass' }));
    await sleep(2000);
    
    // Check for biddingWon
    const biddingWon = findMessage(alice.messages, 'biddingWon');
    if (biddingWon) {
      console.log(`   ✓ Bidding complete! Winner: seat ${biddingWon.winner}, amount: ${biddingWon.amount}`);
    } else {
      console.log('   ⚠️  No biddingWon message received');
      console.log(`   Alice messages: ${alice.messages.map(m => m.action).join(', ')}`);
    }
    
    // ============ STEP 7: Bid winner receives kitty ============
    console.log('\n7️⃣  Checking kitty...');
    await sleep(500);
    
    const kittyMsg = findMessage(alice.messages, 'kitty');
    if (kittyMsg) {
      console.log(`   ✓ Alice received kitty: ${kittyMsg.cards.length} cards`);
      console.log(`   Alice now has ${alice.getCards().length} cards`);
    } else {
      console.log('   ⚠️  No kitty message received');
    }
    
    // ============ STEP 8: Discard and select trump ============
    console.log('\n8️⃣  Discarding 5 cards and selecting trump...');
    
    // Pick 5 cards to discard (first 5 from hand)
    const aliceCards = alice.getCards();
    console.log(`   Alice has ${aliceCards.length} cards before discard`);
    const cardsToDiscard = aliceCards.slice(0, 5);
    console.log(`   Discarding: ${cardsToDiscard.join(', ')}`);
    
    // Update Alice's local hand after discard
    const aliceNewHand = aliceCards.filter(c => !cardsToDiscard.includes(c));
    alice.setCards(aliceNewHand);
    console.log(`   Alice has ${alice.getCards().length} cards after discard`);
    
    alice.ws.send(JSON.stringify({
      action: 'discardAndTrump',
      discard: cardsToDiscard,
      trump: 'Red'
    }));
    
    await sleep(1500);
    
    // Check for trumpChosen
    const trumpChosen = findMessage(alice.messages, 'trumpChosen');
    if (trumpChosen) {
      console.log(`   ✓ Trump selected: ${trumpChosen.suit}`);
    } else {
      console.log('   ⚠️  No trumpChosen message received');
    }
    
    // Check for playStart (can be separate or batched in trumpChosen)
    let playStart = findMessage(alice.messages, 'playStart');
    if (!playStart) {
      // Check if it's batched in trumpChosen
      const trumpChosen = findMessage(alice.messages, 'trumpChosen');
      if (trumpChosen && trumpChosen.leader !== undefined) {
        playStart = { leader: trumpChosen.leader };
      }
    }
    if (playStart) {
      console.log(`   ✓ Play started! Leader: seat ${playStart.leader}`);
    } else {
      console.log('   ⚠️  No playStart message received');
    }
    
    // ============ STEP 9: Quick Chat Test ============
    console.log('\n9️⃣  Testing Quick Chat...');
    
    alice.ws.send(JSON.stringify({
      action: 'quickChat',
      message: 'Good luck everyone!'
    }));
    
    await sleep(800);
    
    // Check if Bob received the quick chat
    const quickChatMsg = findMessage(bob.messages, 'quickChat');
    if (quickChatMsg) {
      console.log(`   ✓ Quick chat received by Bob: "${quickChatMsg.message}" from seat ${quickChatMsg.seat}`);
    } else {
      console.log('   ⚠️  No quickChat message received by Bob');
    }
    
    // ============ STEP 10: Play a trick ============
    console.log('\n🔟  Playing first trick...');
    
    // Refresh hands after discard
    await sleep(500);
    
    // Get current player from playStart
    // After seat rearrangement: alice=0, charlie=1, bob=2, diana=3
    let currentPlayer = playStart?.leader ?? 0;
    console.log(`   Trick leader: seat ${currentPlayer}`);
    
    // Helper to wait for nextPlayer message for a specific seat
    // Handles both batched (in cardPlayed) and separate messages
    async function waitForNextPlayer(player, expectedSeat, timeout = 5000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        // Check for separate nextPlayer message
        const nextPlayerMsg = findLastMessage(player.messages, 'nextPlayer');
        if (nextPlayerMsg && nextPlayerMsg.seat === expectedSeat) {
          return true;
        }
        // Check for batched nextPlayer in cardPlayed
        const cardPlayedMsg = findLastMessage(player.messages, 'cardPlayed');
        if (cardPlayedMsg && cardPlayedMsg.nextPlayer === expectedSeat) {
          return true;
        }
        // Also check for trickWon (end of trick)
        if (findLastMessage(player.messages, 'trickWon')) {
          return true;
        }
        await sleep(100);
      }
      return false;
    }
    
    // Helper to find a playable card (follow suit if possible)
    function findPlayableCard(hand, ledSuit) {
      if (!ledSuit) {
        // Leading the trick - play any card
        return hand[0];
      }
      
      // Try to follow suit
      const suitCards = hand.filter(c => c.startsWith(ledSuit));
      if (suitCards.length > 0) {
        return suitCards[0];
      }
      
      // No cards of that suit - play any card (could play trump or off-suit)
      return hand[0];
    }
    
    // Get the suit from a card
    function getCardSuit(card) {
      if (card === 'Rook') return 'Rook';
      const match = card.match(/^(Red|Green|Yellow|Black)/);
      return match ? match[1] : null;
    }
    
    let ledSuit = null;
    
    // Each player plays a card in seat order
    for (let i = 0; i < 4; i++) {
      const seatToPlay = (currentPlayer + i) % 4;
      const player = seatToPlayer[seatToPlay];
      const playerName = seatToName[seatToPlay];
      
      // Get player's current hand
      let hand = player.getCards();
      
      console.log(`   ${playerName} (seat ${seatToPlay}) has ${hand.length} cards`);
      
      if (hand.length === 0) {
        console.log(`   ⚠️  ${playerName} has no cards!`);
        continue;
      }
      
      // Find a valid card to play (follow suit)
      const cardToPlay = findPlayableCard(hand, ledSuit);
      
      // If this is the first card, set the led suit
      if (i === 0) {
        ledSuit = getCardSuit(cardToPlay);
        console.log(`   ${playerName} leads with ${cardToPlay} (led suit: ${ledSuit})`);
      } else {
        console.log(`   ${playerName} (seat ${seatToPlay}) plays: ${cardToPlay}`);
      }
      
      player.ws.send(JSON.stringify({
        action: 'playCard',
        card: cardToPlay
      }));
      
      // Update local hand
      player.setCards(hand.filter(c => c !== cardToPlay));
      
      // Wait for next player (unless this is the last card of the trick)
      if (i < 3) {
        const nextSeat = (currentPlayer + i + 1) % 4;
        if (!await waitForNextPlayer(alice, nextSeat)) {
          console.log(`   ⚠️  Timeout waiting for nextPlayer seat ${nextSeat}`);
        }
      } else {
        // Wait for trickWon
        await sleep(1500);
      }
    }
    
    await sleep(1000);
    
    // Check for cardPlayed messages
    const cardPlayedMsgs = alice.messages.filter(m => m.action === 'cardPlayed');
    console.log(`   Cards played: ${cardPlayedMsgs.length}`);
    
    // Check for trickWon
    const trickWon = findLastMessage(alice.messages, 'trickWon');
    if (trickWon) {
      console.log(`   ✓ Trick won by seat ${trickWon.winner}!`);
    } else {
      console.log('   ⚠️  No trickWon message received');
    }
    
    // ============ Summary ============
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const results = [
      ['Player Join Broadcasts', alice.messages.filter(m => m.action === 'playerJoined').length === 3],
      ['Deal Cards', players.every(p => findMessage(p.messages, 'deal'))],
      ['Seats Rearranged', !!findMessage(alice.messages, 'seatsRearranged')],
      ['Bidding Start', !!findMessage(alice.messages, 'biddingStart')],
      ['Bid Placed', !!findMessage(alice.messages, 'bidPlaced')],
      ['Bidding Won', !!biddingWon],
      ['Kitty Received', !!kittyMsg],
      ['Trump Selected', !!trumpChosen],
      ['Play Started', !!playStart],
      ['Quick Chat', !!quickChatMsg],
      ['Cards Played', cardPlayedMsgs.length >= 4],
      ['Trick Won', !!trickWon],
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const [name, success] of results) {
      if (success) {
        console.log(`   ✅ ${name}`);
        passed++;
      } else {
        console.log(`   ❌ ${name}`);
        failed++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    if (failed === 0) {
      console.log(`🎉 ALL ${passed} TESTS PASSED!\n`);
    } else {
      console.log(`⚠️  ${passed} passed, ${failed} failed\n`);
    }
    
    // Cleanup
    console.log('Cleaning up connections...');
    players.forEach(p => p.ws.close());
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    players.forEach(p => p.ws?.close());
    process.exit(1);
  }
}

runTest();
