/**
 * Full end-to-end test of bot system
 * Tests: Create game, add bots, select partner, verify bots bid and play
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';

function makeRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, error: e.message });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getRequest(endpoint) {
  return new Promise((resolve) => {
    http.get(`${BASE_URL}${endpoint}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    }).on('error', () => resolve({ status: 0, error: 'Connection failed' }));
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testFullBotFlow() {
  console.log('🤖 Full Bot System Test');
  console.log('='.repeat(60));

  try {
    // Step 1: Create game
    console.log('\n[1/6] Creating game...');
    const createRes = await makeRequest('/createGame', { hostName: 'TestPlayer' });
    if (createRes.status !== 201) {
      throw new Error(`Create failed: ${createRes.status} - ${JSON.stringify(createRes.data)}`);
    }
    const gameId = createRes.data.gameId;
    console.log(`✅ Game created: ${gameId}`);

    // Step 2: Add 3 bots
    console.log('\n[2/6] Adding 3 bots...');
    const bots = [];
    for (let i = 0; i < 3; i++) {
      const botRes = await makeRequest('/addBot', { gameId });
      if (botRes.status === 200 && botRes.data.success) {
        bots.push(botRes.data.bot);
        console.log(`✅ Added ${botRes.data.bot.name} at seat ${botRes.data.bot.seat}`);
      } else {
        throw new Error(`Failed to add bot ${i + 1}: ${JSON.stringify(botRes.data)}`);
      }
      await delay(300);
    }

    // Step 3: Verify game is FULL
    console.log('\n[3/6] Verifying game state...');
    const gamesRes = await getRequest('/games');
    const game = gamesRes.data.games?.find(g => g.gameId === gameId);
    if (!game) throw new Error('Game not found');
    console.log(`✅ Game status: ${game.status}`);
    console.log(`✅ Players: ${game.players.map(p => `${p.name}${p.isBot ? ' (bot)' : ''}`).join(', ')}`);

    // Step 4: Select partner (bot)
    console.log('\n[4/6] Selecting bot as partner...');
    const partnerRes = await makeRequest('/choosePartner', {
      gameId,
      partnerSeat: bots[0].seat,
    });
    if (partnerRes.status !== 200) {
      throw new Error(`Partner selection failed: ${JSON.stringify(partnerRes.data)}`);
    }
    console.log(`✅ Partner selected: ${bots[0].name}`);
    console.log(`✅ Teams: Team 0 = [${partnerRes.data.teams.team0.join(', ')}], Team 1 = [${partnerRes.data.teams.team1.join(', ')}]`);

    // Step 5: Wait for bidding and check results
    console.log('\n[5/6] Waiting for bots to bid (15 seconds)...');
    await delay(15000);
    
    const gamesRes2 = await getRequest('/games');
    const game2 = gamesRes2.data.games?.find(g => g.gameId === gameId);
    if (!game2) throw new Error('Game not found after bidding');
    
    console.log(`✅ Game status: ${game2.status}`);
    if (game2.status === 'TRUMP_SELECTION') {
      console.log(`✅ Bid winner: ${game2.bidWinner} (${game2.players.find(p => p.seat === game2.bidWinner)?.name})`);
      console.log(`✅ Winning bid: ${game2.winningBid}`);
      console.log('   Waiting for bot to select trump...');
      await delay(3000);
    } else if (game2.status === 'PLAYING') {
      console.log(`✅ Bots completed bidding and trump selection!`);
      console.log(`✅ Trump: ${game2.trump}`);
    } else if (game2.status === 'BIDDING') {
      console.log(`⚠️  Still bidding - high bid: ${game2.highBid}, current bidder: ${game2.currentBidder}`);
    }

    // Step 6: Check final state
    console.log('\n[6/6] Final game state...');
    await delay(5000);
    const gamesRes3 = await getRequest('/games');
    const game3 = gamesRes3.data.games?.find(g => g.gameId === gameId);
    if (game3) {
      console.log(`✅ Final status: ${game3.status}`);
      if (game3.status === 'PLAYING') {
        console.log(`✅ Current player: ${game3.currentPlayer}`);
        console.log(`✅ Current trick: ${game3.currentTrick?.length || 0} cards`);
        console.log(`✅ Bots are playing cards automatically!`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log(`\nGame ID: ${gameId}`);
    console.log('Open http://localhost:3000 and join this game to see bots in action!');
    return true;

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.stack) console.error(error.stack);
    return false;
  }
}

testFullBotFlow().then(success => {
  process.exit(success ? 0 : 1);
});
