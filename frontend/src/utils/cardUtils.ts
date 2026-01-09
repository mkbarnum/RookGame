// Utility functions for card operations

import { Card } from '../types/game';

export type CardSortMethod = 'left-to-right' | 'left-to-right-goofy' | 'right-to-left';

/**
 * Parse a card string (e.g., "Green14", "Rook") into a Card object
 */
export function parseCard(cardString: string): Card {
  if (cardString === 'Rook') {
    return { color: 'Rook', rank: null };
  }
  
  // Match suit and rank (e.g., "Green14" -> suit: "Green", rank: 14)
  const match = cardString.match(/^(Red|Green|Yellow|Black)(\d+)$/);
  if (!match) {
    console.warn(`Invalid card string: ${cardString}`);
    return { color: 'Red', rank: 1 }; // Default fallback
  }
  
  return {
    color: match[1] as Card['color'],
    rank: parseInt(match[2], 10),
  };
}

/**
 * Convert a Card object to a card string
 */
export function cardToString(card: Card): string {
  if (card.color === 'Rook') {
    return 'Rook';
  }
  return `${card.color}${card.rank}`;
}

/**
 * Sort cards based on the specified sort method
 * 
 * Sort methods:
 * - 'left-to-right': 2 → 14, then 1 (Ace high) - default Rook ordering
 * - 'left-to-right-goofy': 1 → 14 (simple numeric order)
 * - 'right-to-left': 1 ← 2 (high cards on right, reversed)
 */
export function sortCards(cards: Card[], sortMethod: CardSortMethod = 'left-to-right'): Card[] {
  const colorOrder: Record<string, number> = {
    Green: 0,
    Red: 1,
    Yellow: 2,
    Black: 3,
    Rook: 4,
  };

  const getRankValue = (rank: number | null, method: CardSortMethod): number => {
    if (rank === null) return -1;
    
    switch (method) {
      case 'left-to-right':
        // 2 → 14, then 1 (Ace is highest, so rank 1 becomes 15)
        if (rank === 1) return 15;
        return rank;
      
      case 'left-to-right-goofy':
        // Simple numeric: 1 → 14
        return rank;
      
      case 'right-to-left':
        // Reversed: high cards on right (1 is highest, so we invert)
        // We want: 1 (highest) on right, 2-14 descending to left
        if (rank === 1) return 15;
        return rank;
      
      default:
        if (rank === 1) return 15;
        return rank;
    }
  };

  const sorted = [...cards].sort((a, b) => {
    const colorDiff = colorOrder[a.color] - colorOrder[b.color];
    if (colorDiff !== 0) return colorDiff;
    return getRankValue(a.rank, sortMethod) - getRankValue(b.rank, sortMethod);
  });

  // For right-to-left, reverse the entire array so high cards are on the right
  if (sortMethod === 'right-to-left') {
    return sorted.reverse();
  }

  return sorted;
}

/**
 * Check if a card is playable given the current trick state
 */
export function isCardPlayable(
  card: Card,
  hand: Card[],
  ledSuit: string | undefined,
  trump: string | undefined
): boolean {
  if (!ledSuit) {
    // First card of trick - anything goes
    return true;
  }

  const cardSuit = card.color === 'Rook' ? 'Rook' : card.color;

  // If player has cards of the led suit, they must play one
  const hasLedSuit = hand.some(c => {
    const suit = c.color === 'Rook' ? 'Rook' : c.color;
    return suit === ledSuit;
  });

  if (hasLedSuit) {
    // Must play led suit
    if (cardSuit === ledSuit) {
      return true;
    }
    // Rook is always trump, so it only counts as following if led suit is trump
    if (cardSuit === 'Rook' && ledSuit === trump) {
      return true;
    }
    // Cannot play other suits if player has led suit cards
    return false;
  }

  // No led suit cards - can play anything (including Rook)
  return true;
}

/**
 * Get color symbol for display
 */
export function getColorSymbol(color: string): string {
  switch (color) {
    case 'Green': return '●';
    case 'Red': return '●';
    case 'Yellow': return '●';
    case 'Black': return '●';
    default: return '♜';
  }
}
