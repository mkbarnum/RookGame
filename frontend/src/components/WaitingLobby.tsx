import React, { useState } from 'react';
import { GameState, Player } from '../types/game';
import { PartnerSelectionModal } from './PartnerSelectionModal';
import './WaitingLobby.css';

interface WaitingLobbyProps {
  gameState: GameState;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPartnerSelected?: () => void;
}

export const WaitingLobby: React.FC<WaitingLobbyProps> = ({
  gameState,
  onRefresh,
  isRefreshing,
  onPartnerSelected,
}) => {
  const seatLabels = ['Host', 'Player 2', 'Player 3', 'Player 4'];
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  
  // Create a map of occupied seats
  const seatMap = new Map<number, Player>();
  gameState.players.forEach(p => seatMap.set(p.seat, p));

  return (
    <div className="waiting-lobby">
      <div className="waiting-card">
        <div className="waiting-header">
          <div className="rook-icon">♜</div>
          <h1>Waiting for Players</h1>
          <p className="status-text">
            {gameState.status === 'FULL' 
              ? 'All players joined! Waiting to start...' 
              : `${gameState.players.length}/4 players joined`}
          </p>
        </div>

        {/* Show game code section when waiting for players, or start button when full */}
        {gameState.status !== 'FULL' || gameState.players.length < 4 ? (
          <div className="game-code-section">
            <label>Game Code</label>
            <div className="game-code-display">
              <span className="code">{gameState.gameId}</span>
              <button 
                className="copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(gameState.gameId);
                }}
                title="Copy game code"
              >
                📋
              </button>
            </div>
            <p className="share-hint">Share this code with friends to join!</p>
          </div>
        ) : (
          <>
            {/* Start Game button - only show if game is FULL and user is host */}
            {gameState.isHost && (
              <button 
                type="button"
                className="start-game-btn"
                onClick={() => setShowPartnerModal(true)}
              >
                🎮 Start Game
              </button>
            )}

            {/* Waiting message for non-hosts when game is full */}
            {!gameState.isHost && (
              <div className="waiting-message">
                <p>⏳ Waiting for host to start the game...</p>
              </div>
            )}
          </>
        )}

        <div className="players-section">
          <h3>Players</h3>
          <div className="players-grid">
            {[0, 1, 2, 3].map(seat => {
              const player = seatMap.get(seat);
              const isYou = seat === gameState.seat;
              
              return (
                <div 
                  key={seat} 
                  className={`player-slot ${player ? 'occupied' : 'empty'} ${isYou ? 'is-you' : ''}`}
                >
                  <div className="player-avatar-slot">
                    {player ? player.name[0].toUpperCase() : '?'}
                  </div>
                  <div className="player-info-slot">
                    <span className="player-label">{seatLabels[seat]}</span>
                    <span className="player-name-slot">
                      {player ? player.name : 'Waiting...'}
                      {isYou && ' (You)'}
                    </span>
                  </div>
                  <div className={`status-indicator ${player ? 'ready' : 'waiting'}`}>
                    {player ? '✓' : '○'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Partner Selection Modal */}
        <PartnerSelectionModal
          isOpen={showPartnerModal}
          onClose={() => setShowPartnerModal(false)}
          players={gameState.players}
          gameId={gameState.gameId}
          onPartnerSelected={() => {
            setShowPartnerModal(false);
            if (onPartnerSelected) {
              onPartnerSelected();
            }
          }}
        />
      </div>
    </div>
  );
};
