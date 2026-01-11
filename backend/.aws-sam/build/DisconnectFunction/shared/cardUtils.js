/**
 * Card utility functions for bot AI and game logic
 */

/**
 * Get the suit of a card string
 * @param {string} card - Card string (e.g., "Red5", "Rook")
 * @returns {string|null} Suit name or "Rook" or null
 */
function getCardSuit(card) {
  if (card === 'Rook') return 'Rook';
  const suitMatch = card.match(/^(Red|Green|Yellow|Black)/);
  return suitMatch ? suitMatch[1] : null;
}

/**
 * Get the rank of a card
 * @param {string} card - Card string
 * @returns {number} Rank (1-14, or 0 for Rook)
 */
function getCardRank(card) {
  if (card === 'Rook') return 0;
  const rankMatch = card.match(/(\d+)$/);
  return rankMatch ? parseInt(rankMatch[1], 10) : 0;
}

/**
 * Get the point value of a card
 * @param {string} card - Card string
 * @returns {number} Point value (5, 10, 15, 20, or 0)
 */
function getCardPointValue(card) {
  if (card === 'Rook') return 20;
  const rank = getCardRank(card);
  if (rank === 1) return 15;
  if (rank === 5) return 5;
  if (rank === 10) return 10;
  if (rank === 14) return 10;
  return 0;
}

/**
 * Check if a card is a point card
 * @param {string} card - Card string
 * @returns {boolean} True if card has point value
 */
function isPointCard(card) {
  return getCardPointValue(card) > 0;
}

/**
 * Get the play value of a card for trick-winning purposes
 * @param {string} card - Card string
 * @param {string} trump - Trump suit
 * @param {string} ledSuit - Led suit (or null if leading)
 * @returns {number} Play value (higher = better)
 */
function getCardPlayValue(card, trump, ledSuit) {
  if (card === 'Rook') {
    // Rook is ALWAYS trump (lowest trump card)
    // Returns 100 to indicate trump-level (beats any non-trump)
    // but lower than any regular trump card (100 + rank where rank >= 1)
    return 100;
  }

  const suit = getCardSuit(card);
  const rank = getCardRank(card);

  // Convert rank to play value (1 = 15, 14 = 14, others = rank)
  let rankValue;
  if (rank === 1) rankValue = 15;
  else if (rank === 14) rankValue = 14;
  else rankValue = rank;

  // Trump cards are highest
  if (suit === trump) {
    return 100 + rankValue;
  }

  // Led suit cards are next
  if (ledSuit && suit === ledSuit) {
    return rankValue;
  }

  // Off-suit cards can't win (unless no one followed suit)
  return -1;
}

/**
 * Compare two cards to determine which wins in a trick
 * @param {string} card1 - First card
 * @param {string} card2 - Second card
 * @param {string} trump - Trump suit
 * @param {string} ledSuit - Led suit
 * @returns {number} Positive if card1 wins, negative if card2 wins, 0 if equal
 */
function compareCards(card1, card2, trump, ledSuit) {
  const value1 = getCardPlayValue(card1, trump, ledSuit);
  const value2 = getCardPlayValue(card2, trump, ledSuit);
  return value1 - value2;
}

/**
 * Get valid cards to play based on suit-following rules
 * @param {Array<string>} hand - Player's hand
 * @param {string|null} ledSuit - Led suit (null if leading)
 * @param {string} trump - Trump suit
 * @returns {Array<string>} Valid cards to play
 */
function getValidPlays(hand, ledSuit, trump) {
  if (!ledSuit) {
    // Leading - can play any card
    return [...hand];
  }

  // Check if player has cards of the led suit
  const hasLedSuit = hand.some(card => {
    const suit = getCardSuit(card);
    return suit === ledSuit || (suit === 'Rook' && ledSuit === trump);
  });

  if (hasLedSuit) {
    // Must follow suit
    return hand.filter(card => {
      const suit = getCardSuit(card);
      return suit === ledSuit || (suit === 'Rook' && ledSuit === trump);
    });
  }

  // Can play any card (no led suit)
  return [...hand];
}

/**
 * Count cards by suit
 * @param {Array<string>} hand - Player's hand
 * @returns {object} Object with suit counts { Red: 3, Green: 5, ... }
 */
function countCardsBySuit(hand) {
  const counts = { Red: 0, Green: 0, Yellow: 0, Black: 0, Rook: 0 };
  for (const card of hand) {
    const suit = getCardSuit(card);
    if (suit && counts.hasOwnProperty(suit)) {
      counts[suit]++;
    }
  }
  return counts;
}

/**
 * Sort cards by play value (for bot decision-making)
 * @param {Array<string>} cards - Cards to sort
 * @param {string} trump - Trump suit
 * @param {string|null} ledSuit - Led suit (optional)
 * @param {boolean} ascending - Sort ascending (low to high) or descending
 * @returns {Array<string>} Sorted cards
 */
function sortCardsByValue(cards, trump, ledSuit = null, ascending = true) {
  return [...cards].sort((a, b) => {
    const valueA = getCardPlayValue(a, trump, ledSuit);
    const valueB = getCardPlayValue(b, trump, ledSuit);
    return ascending ? valueA - valueB : valueB - valueA;
  });
}

/**
 * Calculate total points in a hand
 * @param {Array<string>} hand - Player's hand
 * @returns {number} Total point value
 */
function calculateHandPoints(hand) {
  return hand.reduce((sum, card) => sum + getCardPointValue(card), 0);
}

module.exports = {
  getCardSuit,
  getCardRank,
  getCardPointValue,
  isPointCard,
  getCardPlayValue,
  compareCards,
  getValidPlays,
  countCardsBySuit,
  sortCardsByValue,
  calculateHandPoints,
};
