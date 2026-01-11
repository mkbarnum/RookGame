/**
 * Production Bot Test - Full Round
 * Tests: 1 real player (host) joins game, adds 3 bots, selects partner, plays full round
 * Uses production AWS server
 */

const WebSocket = require('ws');
const https = require('https');

// Production URLs from deployment
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
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, error: e.message });
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
      try {
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
        
        const preview = JSON.stringify(msg).slice(0, 80);
        console.log(`  📨 ${playerName}: ${msg.action || msg.type || 'unknown'} - ${preview}...`);
      } catch (e) {
        console.log(`  ⚠️  ${playerName}: Failed to parse message: ${data.toString().slice(0, 50)}`);
      }
    });
    
    ws.on('error', (error) => {
      console.error(`  ❌ ${playerName} WebSocket error:`, error.message);
      reject(error);
    });
    
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Connection timeout'));
      }
    }, 15000);
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

async function waitForGameState(host, expectedStatus, timeout = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const stateMsg = findLastMessage(host.messages, 'gameState');
    if (stateMsg && stateMsg.status === expectedStatus) {
      return true;
    }
    // Also check for specific action messages that indicate status
    if (expectedStatus === 'BIDDING' && findLastMessage(host.messages, 'biddingStart')) {
      return true;
    }
    if (expectedStatus === 'TRUMP_SELECTION' && findLastMessage(host.messages, 'biddingWon')) {
      return true;
    }
    if (expectedStatus === 'PLAYING' && findLastMessage(host.messages, 'playStart')) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function runProductionBotTest() {
  console.log('\n🤖 PRODUCTION BOT TEST - FULL ROUND');
  console.log('='.repeat(70));
  console.log(`🌐 Testing against: ${HTTP_API}`);
  console.log(`🔌 WebSocket: ${WS_API}`);
  console.log('='.repeat(70));
  
  const hostWs = null;
  
  try {
    // ============ STEP 1: Create game as real player (host) ============
    console.log('\n[1/7] Creating game as host (real player)...');
    const createRes = await httpPost('/createGame', { hostName: 'TestHost' });
    
    if (createRes.status !== 201 || !createRes.data.success) {
      throw new Error(`Failed to create game: ${JSON.stringify(createRes.data)}`);
    }
    
    const gameId = createRes.data.gameId;
    console.log(`  ✓ Game created: ${gameId}`);
    
    // ============ STEP 2: Connect host via WebSocket (real player) ============
    console.log('\n[2/7] Connecting host via WebSocket...');
    const host = await connectWebSocket(gameId, 'TestHost', 0);
    console.log(`  ✓ Host connected and ready`);
    
    // Wait a bit for connection to stabilize
    await sleep(1000);
    
    // ============ STEP 3: Add 3 bots ============
    console.log('\n[3/7] Adding 3 bots...');
    const bots = [];
    for (let i = 0; i < 3; i++) {
      const botRes = await httpPost('/addBot', { gameId });
      
      if (botRes.status !== 200 || !botRes.data.success) {
        throw new Error(`Failed to add bot ${i + 1}: ${JSON.stringify(botRes.data)}`);
      }
      
      bots.push(botRes.data.bot);
      console.log(`  ✓ ${botRes.data.bot.name} added at seat ${botRes.data.bot.seat}`);
      await sleep(500); // Small delay between bot additions
    }
    
    // Wait for all playerJoined messages to propagate
    await sleep(1500);
    console.log(`  ✓ All 3 bots added. Game should now be FULL.`);
    console.log(`  ✓ Host received ${host.messages.filter(m => m.action === 'playerJoined').length} playerJoined messages`);
    
    // ============ STEP 4: Select partner (choose a bot) ============
    console.log('\n[4/7] Selecting bot as partner...');
    const partnerBot = bots[0]; // Choose first bot as partner
    console.log(`  Selecting ${partnerBot.name} (seat ${partnerBot.seat}) as partner...`);
    
    const partnerRes = await httpPost('/choosePartner', {
      gameId,
      partnerSeat: partnerBot.seat,
    });
    
    if (partnerRes.status !== 200 || partnerRes.data.error) {
      throw new Error(`Failed to select partner: ${JSON.stringify(partnerRes.data)}`);
    }
    
    console.log(`  ✓ Partner selected: ${partnerBot.name}`);
    console.log(`  ✓ Teams: Team 0 = [${partnerRes.data.teams.team0.join(', ')}], Team 1 = [${partnerRes.data.teams.team1.join(', ')}]`);
    
    // Wait for cards to be dealt
    await sleep(2000);
    
    // Verify cards were dealt
    const dealMsg = findMessage(host.messages, 'deal');
    if (dealMsg && dealMsg.cards) {
      console.log(`  ✓ Cards dealt: Host has ${dealMsg.cards.length} cards`);
    } else {
      console.log(`  ⚠️  No deal message received yet`);
    }
    
    // ============ STEP 5: Host passes to let bots bid automatically ============
    console.log('\n[5/7] Host passes, then waiting for bots to complete bidding phase...');
    
    // Wait for bidding to start
    await sleep(3000);
    
    // Check if bidding started and find starting player
    const biddingStartMsg = findLastMessage(host.messages, 'biddingStart');
    if (biddingStartMsg) {
      console.log(`  ✓ Bidding started! Starting player: seat ${biddingStartMsg.startingPlayer}`);
      
      // Host is seat 0, and after seat rearrangement, host should still be at seat 0
      // The starting bidder is the dealer (seat 0 for first hand)
      if (biddingStartMsg.startingPlayer === 0) {
        console.log(`  Host (seat 0) passes to let bots bid automatically...`);
        host.ws.send(JSON.stringify({ action: 'pass' }));
        
        // Wait for pass to process and next bidder message
        await sleep(2000);
        
        const nextBidderMsg = findLastMessage(host.messages, 'nextBidder');
        if (nextBidderMsg) {
          console.log(`  ✓ Next bidder: seat ${nextBidderMsg.seat} (should be a bot)`);
        }
      } else {
        console.log(`  ⚠️  Starting bidder is seat ${biddingStartMsg.startingPlayer} (not host at seat 0)`);
      }
    } else {
      console.log('  ⚠️  Bidding start message not found, waiting...');
      await sleep(2000);
    }
    
    // Now wait for bots to complete bidding automatically
    // Bots will automatically bid with ~1 second delay between actions
    // After host passes, 3 bots need to bid: could take 10-30 seconds
    console.log('  Waiting up to 45 seconds for bots to complete bidding...');
    
    let biddingComplete = false;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      const biddingWon = findLastMessage(host.messages, 'biddingWon');
      if (biddingWon) {
        console.log(`  ✓ Bidding complete! Winner: seat ${biddingWon.winner}, amount: ${biddingWon.amount}`);
        biddingComplete = true;
        break;
      }
    }
    
    if (!biddingComplete) {
      console.log('  ⚠️  Bidding may still be in progress or timed out');
    }
    
    const biddingWon = findLastMessage(host.messages, 'biddingWon');
    if (biddingWon) {
      console.log(`  ✓ Bidding complete! Winner: seat ${biddingWon.winner}, amount: ${biddingWon.amount}`);
    } else {
      console.log('  ⚠️  Bidding may still be in progress or no winner message received');
    }
    
    // ============ STEP 6: Wait for trump selection and discard ============
    console.log('\n[6/7] Waiting for bid winner to select trump and discard...');
    
    // Wait for trump selection (if bot won the bid)
    await sleep(5000);
    
    const trumpChosen = findLastMessage(host.messages, 'trumpChosen');
    if (trumpChosen) {
      console.log(`  ✓ Trump selected: ${trumpChosen.suit}`);
    } else {
      console.log('  ℹ️  Trump may not have been selected yet (or human won bid)');
    }
    
    const playStart = findLastMessage(host.messages, 'playStart');
    if (playStart) {
      console.log(`  ✓ Play started! Leader: seat ${playStart.leader}`);
    } else {
      console.log('  ⚠️  Play may not have started yet');
    }
    
    // ============ STEP 7: Monitor full round of play ============
    console.log('\n[7/7] Monitoring full round of play (bots play automatically)...');
    console.log('  Bots will automatically play cards with ~1 second delay...');
    
    // Monitor for at least one full hand (all players play all cards)
    // A full hand = 13 cards per player (after discard) = 52 total card plays
    // At ~1 second per play, this should take ~52 seconds, but we'll wait longer
    console.log('  Waiting up to 90 seconds for bots to complete a full round...');
    
    let lastCardCount = 0;
    let lastTrickCount = 0;
    const startTime = Date.now();
    const maxWaitTime = 90000; // 90 seconds
    
    while (Date.now() - startTime < maxWaitTime) {
      await sleep(5000); // Check every 5 seconds
      
      const cardPlayedMsgs = host.messages.filter(m => m.action === 'cardPlayed');
      const trickWonMsgs = host.messages.filter(m => m.action === 'trickWon');
      const handCompleteMsgs = host.messages.filter(m => m.action === 'handComplete');
      const gameCompleteMsgs = host.messages.filter(m => m.action === 'gameComplete');
      
      if (cardPlayedMsgs.length > lastCardCount) {
        console.log(`  📊 Progress: ${cardPlayedMsgs.length} cards played, ${trickWonMsgs.length} tricks won`);
        lastCardCount = cardPlayedMsgs.length;
        lastTrickCount = trickWonMsgs.length;
      }
      
      // Check if hand/game is complete
      if (handCompleteMsgs.length > 0) {
        const lastHand = handCompleteMsgs[handCompleteMsgs.length - 1];
        console.log(`  ✓ Hand complete!`);
        console.log(`     Team 0 score: ${lastHand.scores?.team0 || 0}`);
        console.log(`     Team 1 score: ${lastHand.scores?.team1 || 0}`);
        break;
      }
      
      if (gameCompleteMsgs.length > 0) {
        const lastGame = gameCompleteMsgs[gameCompleteMsgs.length - 1];
        console.log(`  ✓ Game complete!`);
        console.log(`     Final scores: ${JSON.stringify(lastGame.finalScores || {})}`);
        break;
      }
    }
    
    // Final status check
    const finalCardPlayed = host.messages.filter(m => m.action === 'cardPlayed').length;
    const finalTrickWon = host.messages.filter(m => m.action === 'trickWon').length;
    
    console.log(`\n  📊 Final Statistics:`);
    console.log(`     Cards played: ${finalCardPlayed}`);
    console.log(`     Tricks won: ${finalTrickWon}`);
    
    // ============ Summary ============
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    
    const results = [
      ['Game Created', !!gameId],
      ['Host Connected', host.ws.readyState === WebSocket.OPEN],
      ['Bots Added (3)', bots.length === 3],
      ['Partner Selected', !!partnerRes.data.success],
      ['Cards Dealt', !!findMessage(host.messages, 'deal')],
      ['Bidding Started', !!findMessage(host.messages, 'biddingStart')],
      ['Bidding Completed', !!biddingWon],
      ['Trump Selected', !!trumpChosen],
      ['Play Started', !!playStart],
      ['Cards Played', finalCardPlayed > 0],
      ['Tricks Won', finalTrickWon > 0],
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
    
    console.log('\n' + '='.repeat(70));
    if (failed === 0) {
      console.log(`🎉 ALL ${passed} TESTS PASSED!`);
      console.log(`\nGame ID: ${gameId}`);
      console.log(`Frontend: https://dqpvq96b4f93p.cloudfront.net`);
      console.log(`You can open the frontend and join this game to observe bots in action!`);
    } else {
      console.log(`⚠️  ${passed} passed, ${failed} failed`);
      console.log(`\n⚠️  Some checks failed, but the test may have partially succeeded.`);
      console.log(`Check the messages above for details.`);
    }
    console.log('='.repeat(70));
    
    // Keep connection open for a bit to see any final messages
    console.log('\nKeeping connection open for 5 more seconds to catch any final messages...');
    await sleep(5000);
    
    // Cleanup
    console.log('\nCleaning up connection...');
    if (host.ws) {
      host.ws.close();
    }
    
    return failed === 0;
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    if (hostWs) {
      hostWs.close();
    }
    return false;
  }
}

// Run the test
runProductionBotTest().then(success => {
  process.exit(success ? 0 : 1);
});
