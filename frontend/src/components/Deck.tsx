import React from 'react';
import { CardBack } from './Card';
import './Deck.css';

interface DeckProps {
  cardCount: number;
  isVisible: boolean;
}

export const Deck: React.FC<DeckProps> = ({ cardCount, isVisible }) => {
  if (!isVisible || cardCount === 0) {
    return null;
  }

  return (
    <div className="deck-container">
      <div className="deck-card">
        <CardBack />
      </div>
      {cardCount > 1 && (
        <div className="deck-count">{cardCount}</div>
      )}
    </div>
  );
};
