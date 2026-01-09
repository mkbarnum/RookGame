import React, { useState, useEffect } from 'react';
import { Card as CardType } from '../types/game';
import { getColorSymbol } from '../utils/cardUtils';
import './Card.css';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  onDoubleClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
}

export const Card: React.FC<CardProps> = ({
  card,
  onClick,
  onDoubleClick,
  selected = false,
  disabled = false,
}) => {
  const colorClass = card.color.toLowerCase();
  const isRook = card.color === 'Rook';
  const [tapCount, setTapCount] = useState(0);

  const handleClick = () => {
    if (disabled) return;

    setTapCount(prev => prev + 1);

    // Reset tap count after 300ms
    setTimeout(() => setTapCount(0), 300);

    if (onClick) {
      onClick();
    }
  };

  // Trigger double-click on second tap
  useEffect(() => {
    if (tapCount === 2 && onDoubleClick) {
      onDoubleClick();
      setTapCount(0);
    }
  }, [tapCount, onDoubleClick]);

  return (
    <button
      className={`card ${colorClass} ${selected ? 'card-selected' : ''} ${disabled ? 'card-disabled' : ''}`}
      onClick={handleClick}
      type="button"
      disabled={disabled}
    >
      <span className="card-top">
        {isRook ? '♜' : card.rank}
      </span>
      <span className="card-symbol">
        {isRook ? 'ROOK' : getColorSymbol(card.color)}
      </span>
      <span className="card-bottom">
        {isRook ? '♜' : card.rank}
      </span>
    </button>
  );
};

export const CardBack: React.FC = () => (
  <div className="card card-back">
    <span className="back-pattern">♜</span>
  </div>
);
