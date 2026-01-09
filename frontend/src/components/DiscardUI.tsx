import React, { useState, useEffect } from 'react';
import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { cardToString } from '../utils/cardUtils';
import './DiscardUI.css';

interface DiscardUIProps {
  hand: CardType[];
  onConfirm: (discardCards: string[], trump: string) => void;
  disabled?: boolean;
}

export const DiscardUI: React.FC<DiscardUIProps> = ({ hand, onConfirm, disabled = false }) => {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [selectedTrump, setSelectedTrump] = useState<string>('');

  const suits = ['Red', 'Green', 'Yellow', 'Black'];

  // Reset selections if hand changes (e.g., when kitty cards are added)
  useEffect(() => {
    setSelectedCards(new Set());
  }, [hand.length]);

  const toggleCardSelection = (card: CardType) => {
    const cardString = cardToString(card);
    const newSelected = new Set(selectedCards);

    if (newSelected.has(cardString)) {
      newSelected.delete(cardString);
    } else if (newSelected.size < 5) {
      newSelected.add(cardString);
    }

    setSelectedCards(newSelected);
  };

  const isCardSelected = (card: CardType) => {
    const cardString = cardToString(card);
    return selectedCards.has(cardString);
  };

  const handleConfirm = () => {
    if (selectedCards.size === 5 && selectedTrump) {
      onConfirm(Array.from(selectedCards), selectedTrump);
    }
  };

  const isConfirmEnabled = selectedCards.size === 5 && selectedTrump && !disabled && hand.length >= 18;

  return (
    <div className="discard-ui">
      <div className="discard-header">
        <h3>You won the bid!</h3>
      </div>

      <div className="trump-selection">
        <select
          value={selectedTrump}
          onChange={(e) => setSelectedTrump(e.target.value)}
          disabled={disabled || hand.length < 18}
        >
          <option value="">Choose Trump</option>
          {suits.map(suit => (
            <option key={suit} value={suit}>{suit}</option>
          ))}
        </select>
      </div>

      <div className="discard-selection">
        <div className="selection-info">
          <span>
            {hand.length < 18 ? 'Waiting for kitty cards...' : `${selectedCards.size}/5 selected`}
          </span>
        </div>
        <div className="discard-hand">
          {hand.map((card, index) => {
            const cardString = cardToString(card);
            const selected = isCardSelected(card);
            return (
              <Card
                key={`${cardString}-${index}`}
                card={card}
                selected={selected}
                onClick={() => !disabled && hand.length >= 18 && toggleCardSelection(card)}
              />
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="confirm-discard-btn"
        onClick={handleConfirm}
        disabled={!isConfirmEnabled}
      >
        {hand.length < 18 ? 'Waiting...' : 'Confirm'}
      </button>
    </div>
  );
};
