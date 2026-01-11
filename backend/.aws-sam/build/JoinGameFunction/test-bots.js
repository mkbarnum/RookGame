/**
 * Test script for bot functionality
 * Tests adding bots, bidding, trump selection, and card playing
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';

function makeRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${endpoint}`;
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

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const responseData = JSON.parse(data);
          resolve({ status: res.statusCode, data: responseData });
        } catch (error) {
          resolve({ status: res.statusCode, data: data, error: error.message });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testBots() {
  console.log('🤖 Testing Bot System');
  console.log('='.repeat(50));

  try {
    // Step 1: Create a game
    console.log('\n[1/8] Creating game...');
    const createResponse = await makeRequest('/createGame', {
      hostName: 'TestHost'
    });

    if (createResponse.status !== 201) {
      throw new Error(`Create game failed: ${createResponse.status}`);
    }

    const gameId = createResponse.data.gameId;
    console.log(`✅ Game created: ${gameId}`);

    // Step 2: Add 3 bots
    console.log('\n[2/8] Adding bots...');
    const botResults = [];
    for (let i = 0; i < 3; i++) {
      const botResponse = await makeRequest('/addBot', { gameId });
      if (botResponse.status === 200) {
        botResults.push(botResponse.data.bot);
        console.log(`✅ Added ${botResponse.data.bot.name} at seat ${botResponse.data.bot.seat}`);
      } else {
        console.error(`❌ Failed to add bot ${i + 1}:`, botResponse.data);
      }
      await delay(500); // Small delay between bot additions
    }

    // Step 3: Check game state
    console.log('\n[3/8] Checking game state...');
    const gamesResponse = await new Promise((resolve) => {
      http.get(`${BASE_URL}/games`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });
    });

    const game = gamesResponse.data.games?.find(g => g.gameId === gameId);
    if (game) {
      console.log(`✅ Game has ${game.players.length} players`);
      console.log(`   Players: ${game.players.map(p => `${p.name}${p.isBot ? ' (bot)' : ''}`).join(', ')}`);
      console.log(`   Status: ${game.status}`);
    }

    // Step 4: Choose partner (host selects a bot)
    console.log('\n[4/8] Host selecting bot as partner...');
    const botPartner = botResults[0];
    const partnerResponse = await makeRequest('/choosePartner', {
      gameId,
      partnerSeat: botPartner.seat,
    });

    if (partnerResponse.status === 200) {
      console.log(`✅ Partner selected: ${botPartner.name}`);
      console.log(`   Teams: Team 0 = [${partnerResponse.data.teams.team0.join(', ')}], Team 1 = [${partnerResponse.data.teams.team1.join(', ')}]`);
    } else {
      console.error(`❌ Failed to select partner:`, partnerResponse.data);
    }

    // Wait for cards to be dealt
    await delay(2000);

    // Step 5: Check if bidding started
    console.log('\n[5/8] Checking bidding phase...');
    const gamesResponse2 = await new Promise((resolve) => {
      http.get(`${BASE_URL}/games`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });
    });

    const game2 = gamesResponse2.data.games?.find(g => g.gameId === gameId);
    if (game2) {
      console.log(`✅ Game status: ${game2.status}`);
      if (game2.status === 'BIDDING') {
        console.log(`   Current bidder: ${game2.currentBidder}`);
        console.log(`   High bid: ${game2.highBid || 0}`);
      }
    }

    // Step 6: Wait for bots to bid (they should bid automatically)
    console.log('\n[6/8] Waiting for bots to bid (should happen automatically with 1s delay)...');
    console.log('   Waiting 10 seconds for bot bidding...');
    await delay(10000);

    // Step 7: Check bidding results
    console.log('\n[7/8] Checking bidding results...');
    const gamesResponse3 = await new Promise((resolve) => {
      http.get(`${BASE_URL}/games`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });
    });

    const game3 = gamesResponse3.data.games?.find(g => g.gameId === gameId);
    if (game3) {
      console.log(`✅ Game status: ${game3.status}`);
      if (game3.status === 'TRUMP_SELECTION') {
        console.log(`   Bid winner: ${game3.bidWinner} (${game3.players.find(p => p.seat === game3.bidWinner)?.name})`);
        console.log(`   Winning bid: ${game3.winningBid}`);
        console.log('   ✅ Bot should automatically select trump and discard...');
      } else if (game3.status === 'PLAYING') {
        console.log(`   ✅ Bots completed bidding and trump selection!`);
        console.log(`   Trump: ${game3.trump}`);
        console.log(`   Current player: ${game3.currentPlayer}`);
      } else {
        console.log(`   Status: ${game3.status}`);
      }
    }

    // Step 8: Wait for bots to play cards
    console.log('\n[8/8] Waiting for bots to play cards...');
    console.log('   Waiting 15 seconds for bot card playing...');
    await delay(15000);

    const gamesResponse4 = await new Promise((resolve) => {
      http.get(`${BASE_URL}/games`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });
    });

    const game4 = gamesResponse4.data.games?.find(g => g.gameId === gameId);
    if (game4) {
      console.log(`✅ Final game status: ${game4.status}`);
      if (game4.status === 'PLAYING') {
        console.log(`   Current player: ${game4.currentPlayer}`);
        console.log(`   Current trick: ${game4.currentTrick?.length || 0} cards`);
        console.log(`   ✅ Bots are playing cards automatically!`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Bot system test completed!');
    console.log('\nTo see the full game in action, open http://localhost:3000');
    console.log(`and create a game with game code: ${gameId}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testBots();
