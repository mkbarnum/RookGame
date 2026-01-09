import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameState, Player } from '../types/game';
import { PartnerSelectionModal } from './PartnerSelectionModal';
import { SettingsModal, CardSortMethod } from './SettingsModal';
import { localStorageUtils } from '../utils/localStorage';
import rookIcon from '../assets/cards/rook.png';
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
  const navigate = useNavigate();
  const seatLabels = ['Host', 'Player 2', 'Player 3', 'Player 4'];
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cardSortMethod, setCardSortMethod] = useState<CardSortMethod>(() => localStorageUtils.getCardSortMethod());
  
  const handleCardSortMethodChange = (method: CardSortMethod) => {
    setCardSortMethod(method);
    localStorageUtils.saveCardSortMethod(method);
  };
  
  // Create a map of occupied seats
  const seatMap = new Map<number, Player>();
  gameState.players.forEach(p => seatMap.set(p.seat, p));

  return (
    <div className="waiting-lobby">
      <button 
        className="back-button"
        onClick={() => navigate('/')}
        type="button"
        aria-label="Back to lobby"
      >
        <svg 
          width="24" 
          height="24" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <button
        className="settings-btn waiting-lobby-settings-btn"
        onClick={() => setShowSettings(true)}
        aria-label="Settings"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <div className="waiting-card">
        <div className="waiting-header">
          <div className="rook-icon">
            <img src={rookIcon} alt="Rook" />
          </div>
        </div>

        {/* Show game code section when waiting for players, or start button when full */}
        {gameState.status !== 'FULL' || gameState.players.length < 4 ? (
          <div className="game-code-section">
            <div className="game-code-display">
              <span className="code">{gameState.gameId}</span>
              <button 
                className="share-btn"
                onClick={async () => {
                  const shareUrl = `${window.location.origin}/?gameId=${gameState.gameId}`;
                  const shareText = `Join my rook game now! ${shareUrl}`;
                  
                  // Use Web Share API if available (mobile devices)
                  if (navigator.share) {
                    try {
                      await navigator.share({
                        title: 'Join my Rook game',
                        text: shareText,
                        url: shareUrl,
                      });
                    } catch (err) {
                      // User cancelled or error occurred, fallback to clipboard
                      if (err instanceof Error && err.name !== 'AbortError') {
                        navigator.clipboard.writeText(shareUrl);
                      }
                    }
                  } else {
                    // Fallback: copy link to clipboard
                    navigator.clipboard.writeText(shareUrl);
                  }
                }}
                title="Share game"
              >
                Share
              </button>
            </div>
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
                Start Game
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
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        cardSortMethod={cardSortMethod}
        onCardSortMethodChange={handleCardSortMethodChange}
      />
    </div>
  );
};
