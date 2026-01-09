import React from 'react';
import { CardBack } from './Card';
import './PlayerInfo.css';

interface PlayerInfoProps {
  name: string;
  cardCount?: number;
  position: 'top' | 'left' | 'right';
  isPartner?: boolean;
  isCurrentTurn?: boolean;
}

export const PlayerInfo: React.FC<PlayerInfoProps> = ({
  name,
  cardCount,
  position,
  isPartner,
  isCurrentTurn,
}) => (
  <div className={`player-info player-${position} ${isPartner ? 'partner' : ''} ${isCurrentTurn ? 'current-turn' : ''}`}>
    <div className="player-avatar">
      {name[0].toUpperCase()}
    </div>
    <div className="player-details">
      <span className="player-name">{name}</span>
      {isPartner && <span className="partner-badge">Partner</span>}
    </div>
    {cardCount !== undefined && (
      <div className="player-card-count">
        <CardBack />
        <span className="count">{cardCount}</span>
      </div>
    )}
  </div>
);
