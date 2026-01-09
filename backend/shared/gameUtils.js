/**
 * Shared game utilities
 */

/**
 * Generate a random game code (6 uppercase letters)
 * @returns {string} A 6-character uppercase game code
 */
function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Removed I and O to avoid confusion with 1 and 0
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Game status constants
 * 
 * Flow: LOBBY -> FULL -> PARTNER_SELECTION -> BIDDING -> TRUMP_SELECTION -> PLAYING -> (repeat from BIDDING for new round) -> FINISHED
 */
const GameStatus = {
  LOBBY: 'LOBBY',                       // Waiting for players to join
  FULL: 'FULL',                         // All 4 players joined, waiting for partner selection
  PARTNER_SELECTION: 'PARTNER_SELECTION', // Host choosing partner (all 4 joined)
  BIDDING: 'BIDDING',                   // Bidding phase
  TRUMP_SELECTION: 'TRUMP_SELECTION',   // Bid winner selecting trump
  PLAYING: 'PLAYING',                   // Playing tricks
  FINISHED: 'FINISHED',                 // Game complete (team reached 200+ points)
};

/**
 * Suit colors in Rook
 */
const Suits = {
  RED: 'Red',
  GREEN: 'Green',
  YELLOW: 'Yellow',
  BLACK: 'Black',
};

/**
 * Maximum number of players in a game
 */
const MAX_PLAYERS = 4;

/**
 * Minimum and maximum bid values
 */
const BID_MIN = 50;
const BID_INCREMENT = 5;

/**
 * Points needed to win the game
 */
const WINNING_SCORE = 200;

/**
 * Create initial game state object
 * @param {string} gameId - The game ID/code
 * @param {string} hostName - Name of the host player
 * @returns {object} Initial game state
 */
function createInitialGameState(gameId, hostName) {
  return {
    gameId,
    hostName,
    players: [
      { seat: 0, name: hostName },
    ],
    status: GameStatus.LOBBY,
    
    // Team configuration (set after partner selection)
    // teams: { team0: [0, 2], team1: [1, 3] } - seats on each team
    teams: null,
    
    // Scoring
    scores: {
      team0: 0, // Team with seats 0 and partner
      team1: 0, // Team with seats 1 and 3 (or whichever)
    },
    
    // Optimistic locking version
    version: 1,
    
    // Timestamps
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    
    // Round/Hand tracking
    currentRound: 0,        // Incremented when dealing begins
    dealer: null,           // Seat of dealer (rotates each round)
    
    // Bidding state
    currentBid: null,       // Current highest bid amount
    highBidder: null,       // Seat of current high bidder
    passedPlayers: [],      // Seats that have passed (can't bid again)
    currentTurn: null,      // Seat of player whose turn it is
    
    // Trump and play state
    trumpColor: null,       // Selected trump suit (Red, Green, Yellow, Black)
    kitty: [],              // 5-card nest (given to bid winner, then discarded)
    
    // Current trick tracking
    currentTrick: [],       // Array of { seat, card } for current trick
    trickLeader: null,      // Seat of player who led the current trick
    
    // Round scoring
    tricksWon: {            // Tricks won this round by each team
      team0: 0,
      team1: 0,
    },
    pointsCaptured: {       // Points captured this round by each team
      team0: 0,
      team1: 0,
    },
  };
}

/**
 * Get the next available seat number
 * @param {Array} players - Array of player objects with seat property
 * @returns {number|null} Next available seat (0-3) or null if full
 */
function getNextAvailableSeat(players) {
  const takenSeats = new Set(players.map(p => p.seat));
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (!takenSeats.has(seat)) {
      return seat;
    }
  }
  return null; // All seats taken
}

/**
 * Check if a player name is already in the game
 * @param {Array} players - Array of player objects
 * @param {string} name - Player name to check
 * @returns {boolean} True if name is taken
 */
function isNameTaken(players, name) {
  return players.some(p => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Build a standard HTTP response
 * @param {number} statusCode - HTTP status code
 * @param {object} body - Response body
 * @returns {object} Lambda HTTP response
 */
function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

module.exports = {
  generateGameCode,
  GameStatus,
  Suits,
  MAX_PLAYERS,
  BID_MIN,
  BID_INCREMENT,
  WINNING_SCORE,
  createInitialGameState,
  getNextAvailableSeat,
  isNameTaken,
  buildResponse,
};
