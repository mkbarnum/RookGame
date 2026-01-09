import React from 'react';
import { Player, TrickWonNotification as TrickWonNotificationType } from '../types/game';
import './TrickWonNotification.css';

interface TrickWonNotificationProps {
  notification: TrickWonNotificationType;
  players: Player[];
}

export const TrickWonNotification: React.FC<TrickWonNotificationProps> = ({
  notification,
  players,
}) => (
  <div className="trick-won-popup">
    <div className="trick-won-content">
      <div className="trick-won-icon">🏆</div>
      <div className="trick-won-text">
        <div className="trick-won-winner">
          {players.find(p => p.seat === notification.winner)?.name || `Player ${notification.winner + 1}`} won the trick!
        </div>
        <div className="trick-won-points">
          {notification.points} points
        </div>
      </div>
    </div>
  </div>
);
