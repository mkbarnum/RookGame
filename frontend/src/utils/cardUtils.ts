// Utility functions for card operations

import { Card } from '../types/game';

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
 * Sort cards: group by color, within each color sort by rank (1 is highest)
 */
export function sortCards(cards: Card[]): Card[] {
  const colorOrder: Record<string, number> = {
    Green: 0,
    Red: 1,
    Yellow: 2,
    Black: 3,
    Rook: 4,
  };

  const getRankValue = (rank: number | null): number => {
    if (rank === null) return -1;
    if (rank === 1) return 15;
    return rank;
  };

  return [...cards].sort((a, b) => {
    const colorDiff = colorOrder[a.color] - colorOrder[b.color];
    if (colorDiff !== 0) return colorDiff;
    return getRankValue(a.rank) - getRankValue(b.rank);
  });
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
