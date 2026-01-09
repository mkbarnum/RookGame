/**
 * Dealing utilities for Rook game
 * 
 * Handles deck construction, shuffling, and dealing cards to players.
 */

const crypto = require('crypto');
const { PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, GAMES_TABLE, HANDS_TABLE } = require('./dynamodb');
const { GameStatus, Suits, BID_MIN } = require('./gameUtils');

/**
 * Construct the full Rook deck
 * @returns {Array<string>} Array of 57 card strings
 */
function constructDeck() {
  const suits = [Suits.RED, Suits.GREEN, Suits.YELLOW, Suits.BLACK];
  const ranks = Array.from({ length: 14 }, (_, i) => i + 1); // 1 through 14
  const deck = [];

  // Add cards for each suit and rank
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${suit}${rank}`);
    }
  }

  // Add the Rook card
  deck.push('Rook');

  return deck;
}

/**
 * Shuffle array using Fisher-Yates algorithm with crypto.randomInt
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array (new array, doesn't modify original)
 */
function shuffleDeck(deck) {
  const shuffled = [...deck]; // Create a copy

  // Fisher-Yates shuffle with crypto.randomInt
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Generate random index using crypto.randomInt (cryptographically secure)
    const j = crypto.randomInt(0, i + 1);
    
    // Swap elements
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Deal cards to players and kitty
 * @param {Array<string>} deck - Shuffled deck
 * @returns {object} Object with hands and kitty
 */
function dealCards(deck) {
  const hands = {
    hand0: deck.slice(0, 13),
    hand1: deck.slice(13, 26),
    hand2: deck.slice(26, 39),
    hand3: deck.slice(39, 52),
  };
  const kitty = deck.slice(52); // Last 5 cards

  return { hands, kitty };
}

/**
 * Store hands in DynamoDB
 * @param {string} gameId - Game ID
 * @param {object} hands - Object with hand0, hand1, hand2, hand3 arrays
 * @returns {Promise<void>}
 */
async function storeHands(gameId, hands) {
  const items = [
    { gameId, seat: 0, cards: hands.hand0 },
    { gameId, seat: 1, cards: hands.hand1 },
    { gameId, seat: 2, cards: hands.hand2 },
    { gameId, seat: 3, cards: hands.hand3 },
  ];

  // Use BatchWrite for efficiency
  const writeRequests = items.map(item => ({
    PutRequest: {
      Item: item,
    },
  }));

  // BatchWrite can handle up to 25 items, so we're fine with 4
  await docClient.send(new BatchWriteCommand({
    RequestItems: {
      [HANDS_TABLE]: writeRequests,
    },
  }));

  console.log(`Stored hands for game ${gameId}`);
}

/**
 * Deal cards and update game state
 * @param {string} gameId - Game ID
 * @param {number} currentVersion - Current game version for optimistic locking
 * @returns {Promise<object>} Object with hands and kitty
 */
async function dealGame(gameId, currentVersion) {
  // Construct and shuffle deck
  const deck = constructDeck();
  const shuffled = shuffleDeck(deck);
  
  // Deal cards
  const { hands, kitty } = dealCards(shuffled);
  
  // Store hands in DynamoDB
  await storeHands(gameId, hands);
  
  // Update game state
  const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
  await docClient.send(new UpdateCommand({
    TableName: GAMES_TABLE,
    Key: { gameId },
    UpdateExpression: `
      SET #status = :status,
          highBid = :highBid,
          currentBid = :currentBid,
          currentBidder = :currentBidder,
          passed = :passed,
          kitty = :kitty,
          trumpColor = :trumpColor,
          version = version + :one,
          updatedAt = :updatedAt
    `,
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': GameStatus.BIDDING,
      ':highBid': 0, // No bid yet
      ':currentBid': BID_MIN, // Starting bid is minimum (for display)
      ':currentBidder': 0, // Host (seat 0) starts bidding
      ':passed': [],
      ':kitty': kitty,
      ':trumpColor': null,
      ':one': 1,
      ':updatedAt': new Date().toISOString(),
      ':currentVersion': currentVersion,
    },
    ConditionExpression: 'version = :currentVersion',
  }));

  console.log(`Dealt cards for game ${gameId}. Hands: ${Object.values(hands).map(h => h.length).join(', ')}, Kitty: ${kitty.length}`);

  return { hands, kitty };
}

module.exports = {
  constructDeck,
  shuffleDeck,
  dealCards,
  storeHands,
  dealGame,
};
