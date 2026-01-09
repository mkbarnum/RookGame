import React, { useState, useEffect } from 'react';
import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { cardToString } from '../utils/cardUtils';
import './DiscardUI.css';

interface DiscardUIProps {
  hand: CardType[];
  kittyCardStrings: Set<string>;
  onConfirm: (discardCards: string[], trump: string) => void;
  disabled?: boolean;
}

export const DiscardUI: React.FC<DiscardUIProps> = ({ hand, kittyCardStrings, onConfirm, disabled = false }) => {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [selectedTrump, setSelectedTrump] = useState<string>('');
  const [showTrumpModal, setShowTrumpModal] = useState<boolean>(false);


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

  const handleTrumpSelect = (trump: string) => {
    setSelectedTrump(trump);
    setShowTrumpModal(false);
  };

  const isConfirmEnabled = selectedCards.size === 5 && selectedTrump && !disabled && hand.length >= 18;

  return (
    <div className="discard-ui">
      <div className="discard-header">
        <h3>You won the bid!</h3>
      </div>

      <div className="trump-selection">
        <button
          type="button"
          className={`trump-select-btn ${selectedTrump ? `trump-selected trump-${selectedTrump.toLowerCase()}` : ''}`}
          onClick={() => setShowTrumpModal(true)}
          disabled={disabled || hand.length < 18}
        >
          {selectedTrump ? '' : 'Choose Trump'}
        </button>
      </div>

      {showTrumpModal && (
        <div className="trump-modal-overlay" onClick={() => setShowTrumpModal(false)}>
          <div className="trump-modal" onClick={(e) => e.stopPropagation()}>
            <div className="trump-color-grid">
              <button
                type="button"
                className="trump-color-btn red"
                onClick={() => handleTrumpSelect('Red')}
              >
              </button>
              <button
                type="button"
                className="trump-color-btn yellow"
                onClick={() => handleTrumpSelect('Yellow')}
              >
              </button>
              <button
                type="button"
                className="trump-color-btn green"
                onClick={() => handleTrumpSelect('Green')}
              >
              </button>
              <button
                type="button"
                className="trump-color-btn black"
                onClick={() => handleTrumpSelect('Black')}
              >
              </button>
            </div>
          </div>
        </div>
      )}

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
            const isFromKitty = kittyCardStrings.has(cardString);
            return (
              <Card
                key={`${cardString}-${index}`}
                card={card}
                selected={selected}
                isKittyCard={isFromKitty}
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
