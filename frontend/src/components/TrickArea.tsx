import React, { useState, useEffect } from 'react';
import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { getAbsoluteSeat } from '../utils/seatUtils';
import './TrickArea.css';

interface TrickAreaProps {
  currentTrick: { seat: number; card: CardType }[];
  mySeat: number;
  trump?: string;
  onCardDrop?: (card: CardType) => void;
  canDrop?: boolean;
}

export const TrickArea: React.FC<TrickAreaProps> = ({
  currentTrick,
  mySeat,
  trump,
  onCardDrop,
  canDrop = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  // Listen for touch-based card drops
  useEffect(() => {
    if (!onCardDrop || !canDrop) return;

    const handleCardDropped = (event: CustomEvent) => {
      const { card } = event.detail;
      onCardDrop(card);
    };

    const trickAreaElement = document.querySelector('.trick-area');
    if (trickAreaElement) {
      trickAreaElement.addEventListener('cardDropped', handleCardDropped as EventListener);
      return () => {
        trickAreaElement.removeEventListener('cardDropped', handleCardDropped as EventListener);
      };
    }
  }, [onCardDrop, canDrop]);

  const handleDragOver = (e: React.DragEvent) => {
    if (!canDrop || !onCardDrop) return;
    
    // Check if this is a card being dragged
    if (e.dataTransfer.types.includes('application/rook-card')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only trigger if we're actually leaving the trick-area (not a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (!canDrop || !onCardDrop) return;
    
    const cardData = e.dataTransfer.getData('application/rook-card');
    if (cardData) {
      try {
        const { card } = JSON.parse(cardData);
        onCardDrop(card);
      } catch (err) {
        console.error('Failed to parse dropped card data:', err);
      }
    }
  };

  return (
    <div 
      className={`trick-area ${isDragOver ? 'drag-over' : ''} ${canDrop ? 'can-drop' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="trick-center">
        {trump ? (
          <span className={`trump-indicator trump-${trump.toLowerCase()}`}>
            Trump: {trump}
          </span>
        ) : (
          <span className="trick-label">Play Area</span>
        )}
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
};