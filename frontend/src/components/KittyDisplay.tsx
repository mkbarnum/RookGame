import React from 'react';
import { CardBack } from './Card';
import './KittyDisplay.css';

interface KittyDisplayProps {
  cardCount: number;
}

export const KittyDisplay: React.FC<KittyDisplayProps> = ({ cardCount }) => (
  <div className="kitty-display">
    <div className="kitty-stack">
      {Array.from({ length: Math.min(cardCount, 3) }).map((_, i) => (
        <div key={i} className="kitty-card" style={{ transform: `translateY(${i * -2}px) rotate(${(i - 1) * 3}deg)` }}>
          <CardBack />
        </div>
      ))}
    </div>
    <span className="kitty-label">Kitty ({cardCount})</span>
  </div>
);
