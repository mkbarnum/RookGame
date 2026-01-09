import React from 'react';
import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { getAbsoluteSeat } from '../utils/seatUtils';
import './TrickArea.css';

interface TrickAreaProps {
  currentTrick: { seat: number; card: CardType }[];
  mySeat: number;
}

export const TrickArea: React.FC<TrickAreaProps> = ({ currentTrick, mySeat }) => (
  <div className="trick-area">
    <div className="trick-center">
      <span className="trick-label">Play Area</span>
    </div>
    {/* Card slots for each player position */}
    <div className="trick-slot slot-top">
      {(() => {
        const topSeat = getAbsoluteSeat(2, mySeat);
        const playedCard = currentTrick.find(play => play.seat === topSeat);
        return playedCard ? <Card card={playedCard.card} /> : null;
      })()}
    </div>
    <div className="trick-slot slot-left">
      {(() => {
        const leftSeat = getAbsoluteSeat(1, mySeat);
        const playedCard = currentTrick.find(play => play.seat === leftSeat);
        return playedCard ? <Card card={playedCard.card} /> : null;
      })()}
    </div>
    <div className="trick-slot slot-right">
      {(() => {
        const rightSeat = getAbsoluteSeat(3, mySeat);
        const playedCard = currentTrick.find(play => play.seat === rightSeat);
        return playedCard ? <Card card={playedCard.card} /> : null;
      })()}
    </div>
    <div className="trick-slot slot-bottom">
      {(() => {
        const bottomSeat = mySeat;
        const playedCard = currentTrick.find(play => play.seat === bottomSeat);
        return playedCard ? <Card card={playedCard.card} /> : null;
      })()}
    </div>
  </div>
);
