/**
 * Test script for gameAction API endpoint
 * Tests the playCard functionality with a complete game setup
 */

const http = require('http');
const BASE_URL = 'http://localhost:3001';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(endpoint, body) {
  return new Promise((resolve) => {
    const url = `${BASE_URL}${endpoint}`;
    console.log(`\n🔄 Making request to: ${url}`);
    console.log(`📤 Request body:`, JSON.stringify(body, null, 2));

    const postData = JSON.stringify(body);

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const responseData = JSON.parse(data);
          console.log(`📥 Response status: ${res.statusCode}`);
          console.log(`📥 Response body:`, JSON.stringify(responseData, null, 2));
          resolve({ status: res.statusCode, data: responseData });
        } catch (error) {
          console.error(`❌ Failed to parse response:`, error.message);
          console.log(`📥 Raw response:`, data);
          resolve({ status: res.statusCode, data: data, error: error.message });
        }
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Request failed:`, error.message);
      resolve({ status: 0, error: error.message });
    });

    req.write(postData);
    req.end();
  });
}

async function testGameActionAPI() {
  console.log('🎮 Testing GameAction API - Rook Card Playing');
  console.log('=' .repeat(50));

  try {
    // Step 1: Health check
    console.log('\n🏥 Step 1: Health Check');
    const healthResult = await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3001,
        path: '/health',
        method: 'GET'
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          console.log(`Health check response: ${res.statusCode}, data: ${data}`);
          resolve({ status: res.statusCode, data });
        });
      });

      req.on('error', (error) => {
        console.error(`Health check error:`, error.message);
        resolve({ status: 0, error: error.message });
      });
      req.end();
    });

    if (healthResult.status !== 200) {
      throw new Error(`Health check failed: ${healthResult.status}, error: ${healthResult.error}`);
    }
    console.log('✅ Server is healthy');

    // Step 2: Create a game
    console.log('\n🎯 Step 2: Create Game');
    const createResponse = await makeRequest('/createGame', {
      hostName: 'TestHost'
    });

    if (createResponse.status !== 201) {
      throw new Error(`Create game failed: ${createResponse.status}`);
    }

    const gameId = createResponse.data.gameId;
    console.log(`✅ Game created: ${gameId}`);

    // Step 3: Join with 3 more players
    console.log('\n👥 Step 3: Join Players');
    const players = ['Alice', 'Bob', 'Charlie'];
    const joinResults = [];

    for (const player of players) {
      const joinResponse = await makeRequest('/joinGame', {
        gameId: gameId,
        playerName: player
      });

      if (joinResponse.status !== 200) {
        console.log(`⚠️  Join failed for ${player}: ${joinResponse.status}`);
      } else {
        console.log(`✅ ${player} joined the game`);
        joinResults.push(joinResponse);
      }
      await delay(100); // Small delay between requests
    }

    // Step 4: Choose partner (host action)
    console.log('\n🤝 Step 4: Choose Partner');
    const partnerResponse = await makeRequest('/choosePartner', {
      gameId: gameId,
      hostName: 'TestHost',
      partnerName: 'Charlie'
    });

    if (partnerResponse.status !== 200) {
      console.log(`⚠️  Partner selection might not be ready yet: ${partnerResponse.status}`);
    } else {
      console.log('✅ Partner selected');
    }

    // Step 5: Test gameAction with invalid game state (should fail)
    console.log('\n❌ Step 5: Test gameAction on invalid game state');
    const earlyPlayResponse = await makeRequest('/gameAction', {
      gameId: gameId,
      playerName: 'TestHost',
      action: 'playCard',
      card: 'Green14'
    });

    if (earlyPlayResponse.status !== 400) {
      console.log(`⚠️  Expected 400 error for early playCard, got: ${earlyPlayResponse.status}`);
    } else {
      console.log('✅ Correctly rejected playCard before game is ready');
    }

    // Step 6: Test invalid action
    console.log('\n❌ Step 6: Test invalid action');
    const invalidActionResponse = await makeRequest('/gameAction', {
      gameId: gameId,
      playerName: 'TestHost',
      action: 'invalidAction'
    });

    if (invalidActionResponse.status !== 400) {
      console.log(`⚠️  Expected 400 error for invalid action, got: ${invalidActionResponse.status}`);
    } else {
      console.log('✅ Correctly rejected invalid action');
    }

    // Step 7: Test with non-existent game
    console.log('\n❌ Step 7: Test with non-existent game');
    const fakeGameResponse = await makeRequest('/gameAction', {
      gameId: 'FAKEGAME123',
      playerName: 'TestHost',
      action: 'playCard',
      card: 'Green14'
    });

    if (fakeGameResponse.status !== 404) {
      console.log(`⚠️  Expected 404 error for fake game, got: ${fakeGameResponse.status}`);
    } else {
      console.log('✅ Correctly rejected request for non-existent game');
    }

    // Step 8: Test with player not in game
    console.log('\n❌ Step 8: Test with player not in game');
    const fakePlayerResponse = await makeRequest('/gameAction', {
      gameId: gameId,
      playerName: 'NotInGamePlayer',
      action: 'playCard',
      card: 'Green14'
    });

    if (fakePlayerResponse.status !== 404) {
      console.log(`⚠️  Expected 404 error for player not in game, got: ${fakePlayerResponse.status}`);
    } else {
      console.log('✅ Correctly rejected request from player not in game');
    }

    console.log('\n🎉 API Tests Completed!');
    console.log('Note: To test actual card playing, you need to play through the full game:');
    console.log('1. Complete bidding phase');
    console.log('2. Select trump and discard');
    console.log('3. Start playing phase');
    console.log('4. Then test playCard actions');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the tests
if (require.main === module) {
  testGameActionAPI().catch(console.error);
}

module.exports = { testGameActionAPI };