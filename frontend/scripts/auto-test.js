#!/usr/bin/env node

/**
 * Auto-test script for local development
 * 
 * Creates a game and opens 4 browser tabs, each auto-joining as a different player
 * 
 * Usage: node scripts/auto-test.js
 */

const { exec } = require('child_process');
const http = require('http');

/**
 * Fetch games from API (Node.js compatible)
 */
async function fetchGames() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/games',
      method: 'GET',
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: async () => json,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';
const FRONTEND_URL = 'http://localhost:3000';

// Player names for the 4 tabs
const PLAYERS = ['Alice', 'Bob', 'Charlie', 'Diana'];

/**
 * Wait for a service to be ready
 */
function waitForService(url, maxAttempts = 30, delay = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const check = () => {
      attempts++;
      const req = http.get(url, (res) => {
        if (res.statusCode === 200 || res.statusCode === 404) {
          // Service is responding (404 is OK, means server is up)
          resolve();
        } else {
          if (attempts >= maxAttempts) {
            reject(new Error(`Service at ${url} not ready after ${maxAttempts} attempts`));
          } else {
            setTimeout(check, delay);
          }
        }
      });
      
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`Service at ${url} not ready after ${maxAttempts} attempts`));
        } else {
          setTimeout(check, delay);
        }
      });
      
      req.end();
    };
    
    check();
  });
}

/**
 * Create a new game
 */
async function createGame(hostName) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ hostName });
    
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/createGame',
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
          const response = JSON.parse(data);
          if (response.success && response.gameId) {
            resolve(response.gameId);
          } else {
            reject(new Error(response.message || 'Failed to create game'));
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
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

/**
 * Open a browser tab with the given URL
 */
function openBrowserTab(url) {
  const platform = process.platform;
  let command;
  
  if (platform === 'darwin') {
    // macOS
    command = `open -a "Google Chrome" "${url}" || open "${url}"`;
  } else if (platform === 'win32') {
    // Windows
    command = `start chrome "${url}" || start "${url}"`;
  } else {
    // Linux
    command = `xdg-open "${url}"`;
  }
  
  exec(command, (error) => {
    if (error) {
      console.error(`Failed to open browser tab: ${error.message}`);
    }
  });
}

/**
 * Main function
 */
async function main() {
  console.log('🎮 Rook Auto-Test Setup');
  console.log('========================\n');
  
  // Step 1: Wait for backend to be ready
  console.log('[1/4] Waiting for backend API...');
  try {
    await waitForService(`${API_BASE_URL}/health`);
    console.log('✓ Backend is ready\n');
  } catch (error) {
    console.error('❌ Backend not ready:', error.message);
    console.error('   Make sure the backend is running at', API_BASE_URL);
    process.exit(1);
  }
  
  // Step 2: Wait for frontend to be ready
  console.log('[2/4] Waiting for frontend...');
  try {
    await waitForService(FRONTEND_URL);
    console.log('✓ Frontend is ready\n');
  } catch (error) {
    console.error('❌ Frontend not ready:', error.message);
    console.error('   Make sure the frontend is running at', FRONTEND_URL);
    process.exit(1);
  }
  
  // Step 3: Open host tab first to create the game
  console.log('[3/4] Opening host tab to create game...');
  const hostUrl = `${FRONTEND_URL}/?autoJoin=true&playerName=${encodeURIComponent(PLAYERS[0])}&isHost=true`;
  console.log(`  Opening tab 1: ${PLAYERS[0]} (Host - will create game)`);
  openBrowserTab(hostUrl);
  
  // Wait for host to create the game, then fetch the game ID
  console.log('  Waiting for game to be created...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  let gameId = null;
  let attempts = 0;
  const maxAttempts = 10;
  
  while (!gameId && attempts < maxAttempts) {
    try {
      const gamesResponse = await fetchGames();
      if (gamesResponse.ok) {
        const gamesData = await gamesResponse.json();
        // Find the most recently created game (should be the one Alice just created)
        const games = gamesData.games || [];
        if (games.length > 0) {
          // Get the most recent game (assuming it's the one we just created)
          const latestGame = games.sort((a, b) => 
            new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
          )[0];
          
          // Verify Alice is the host
          if (latestGame.hostName === PLAYERS[0] || 
              (latestGame.players && latestGame.players.some(p => p.name === PLAYERS[0] && p.seat === 0))) {
            gameId = latestGame.gameId;
            console.log(`✓ Game found: ${gameId}\n`);
            break;
          }
        }
      }
    } catch (error) {
      console.log(`  Attempt ${attempts + 1}: Game not found yet...`);
    }
    
    attempts++;
    if (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (!gameId) {
    console.error('❌ Could not find created game. Opening tabs anyway...');
    console.error('   You may need to manually enter the game code.');
  }
  
  // Step 4: Open remaining player tabs
  console.log('[4/4] Opening remaining player tabs...');
  
  if (gameId) {
    // Tabs 2-4: Other players - auto-join the game
    for (let i = 1; i < PLAYERS.length; i++) {
      const playerUrl = `${FRONTEND_URL}/?autoJoin=true&gameId=${gameId}&playerName=${encodeURIComponent(PLAYERS[i])}`;
      console.log(`  Opening tab ${i + 1}: ${PLAYERS[i]} (will join game ${gameId})`);
      openBrowserTab(playerUrl);
      // Wait between opening tabs to avoid race conditions
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  } else {
    // If we couldn't find the game, still open tabs but they'll need manual entry
    for (let i = 1; i < PLAYERS.length; i++) {
      const playerUrl = `${FRONTEND_URL}/?autoJoin=true&playerName=${encodeURIComponent(PLAYERS[i])}`;
      console.log(`  Opening tab ${i + 1}: ${PLAYERS[i]} (game code needed)`);
      openBrowserTab(playerUrl);
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  
  console.log('\n✅ All tabs opened!');
  if (gameId) {
    console.log(`\nGame Code: ${gameId}`);
  } else {
    console.log('\n⚠️  Could not automatically detect game code.');
    console.log('   Check the host tab for the game code and enter it manually in other tabs if needed.');
  }
  console.log('Players:');
  PLAYERS.forEach((name, index) => {
    console.log(`  ${index + 1}. ${name}${index === 0 ? ' (Host - creates game)' : ' (joins game)'}`);
  });
  console.log('\n💡 Tip: The tabs should automatically fill forms and click buttons.');
}

// Run the script
main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
