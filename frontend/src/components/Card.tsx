import React from 'react';
import { Card as CardType } from '../types/game';
import './Card.css';

// Import card images
import img1 from '../assets/cards/1.png';
import img2 from '../assets/cards/2.png';
import img3 from '../assets/cards/3.png';
import img4 from '../assets/cards/4.png';
import img5 from '../assets/cards/5.png';
import img6 from '../assets/cards/6.png';
import img7 from '../assets/cards/7.png';
import img8 from '../assets/cards/8.png';
import img9 from '../assets/cards/9.png';
import img10 from '../assets/cards/10.png';
import img11 from '../assets/cards/11.png';
import img12 from '../assets/cards/12.png';
import img13 from '../assets/cards/13.png';
import img14 from '../assets/cards/14.png';
import rookImg from '../assets/cards/rook.png';
import kittyImg from '../assets/kitty.png';

const cardImages: { [key: number]: string } = {
  1: img1,
  2: img2,
  3: img3,
  4: img4,
  5: img5,
  6: img6,
  7: img7,
  8: img8,
  9: img9,
  10: img10,
  11: img11,
  12: img12,
  13: img13,
  14: img14,
};

interface CardProps {
  card: CardType;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  isKittyCard?: boolean;
  isFaceDown?: boolean;
  isFlipping?: boolean;
}

export const Card: React.FC<CardProps> = ({
  card,
  onClick,
  selected = false,
  disabled = false,
  isKittyCard = false,
  isFaceDown = false,
  isFlipping = false,
}) => {
  const colorClass = card.color.toLowerCase();
  const isRook = card.color === 'Rook';

  const handleClick = () => {
    if (disabled) return;

    if (onClick) {
      onClick();
    }
  };

  // Render card face (normal card content)
  const renderCardFace = () => {
    if (isRook) {
      return (
        <button
          className={`card rook ${selected ? 'card-selected' : ''} ${disabled ? 'card-disabled' : ''}`}
          onClick={handleClick}
          type="button"
          disabled={disabled}
        >
          <span className="card-corner-number rook-corner">R</span>
          <div className="card-center-frame rook-center-frame">
            <img src={rookImg} alt="Rook" className="card-center-image" />
          </div>
        </button>
      );
    }

    const cardImage = isKittyCard ? kittyImg : (card.rank !== null ? cardImages[card.rank] : undefined);
    return (
      <button
        className={`card card-new-style ${colorClass} ${selected ? 'card-selected' : ''} ${disabled ? 'card-disabled' : ''}`}
        onClick={handleClick}
        type="button"
        disabled={disabled}
      >
        <span className="card-corner-number">{card.rank}</span>
        <div className="card-center-frame">
          {cardImage && <img src={cardImage} alt={isKittyCard ? 'kitty' : `${card.rank}`} className="card-center-image" />}
        </div>
      </button>
    );
  };

  // If dealing (face down or currently flipping), use flip container
  // Once flipped, we can render normally (no flip container needed)
  if (isFaceDown || isFlipping) {
    return (
      <div className={`card-flip-container ${isFlipping ? 'flipping' : ''}`}>
        <div className="card-flip-inner">
          <div className="card-flip-front">
            <CardBack />
          </div>
          <div className="card-flip-back">
            {renderCardFace()}
          </div>
        </div>
      </div>
    );
  }

  // Face up and not dealing - normal rendering (no flip container)
  return renderCardFace();
};

export const CardBack: React.FC = () => (
  <div className="card card-back">
    <span className="back-pattern">
      <img src={rookImg} alt="Rook" className="back-pattern-image" />
    </span>
  </div>
);
