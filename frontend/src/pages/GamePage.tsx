import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import './GamePage.css';

// Player type definition
interface Player {
  seat: number;
  name: string;
}

// Game state from navigation or localStorage
interface GameState {
  gameId: string;
  playerName: string;
  seat: number;
  isHost: boolean;
  players: Player[];
  status: string;
  teams?: { team0: number[]; team1: number[] } | null;
}

// Card type definition
interface Card {
  color: 'Green' | 'Red' | 'Yellow' | 'Black' | 'Rook';
  rank: number | null; // null for Rook card
}

// Dummy data for user's hand (only shown when game is PLAYING)
const userHand: Card[] = [
  { color: 'Green', rank: 1 },
  { color: 'Green', rank: 14 },
  { color: 'Green', rank: 10 },
  { color: 'Green', rank: 5 },
  { color: 'Red', rank: 1 },
  { color: 'Red', rank: 12 },
  { color: 'Red', rank: 7 },
  { color: 'Yellow', rank: 14 },
  { color: 'Yellow', rank: 11 },
  { color: 'Yellow', rank: 6 },
  { color: 'Black', rank: 13 },
  { color: 'Black', rank: 9 },
  { color: 'Rook', rank: null },
];

// Sort cards: group by color, within each color sort by rank (1 is highest)
const sortCards = (cards: Card[]): Card[] => {
  const colorOrder: Record<string, number> = {
    Green: 0,
    Red: 1,
    Yellow: 2,
    Black: 3,
    Rook: 4,
  };

  const getRankValue = (rank: number | null): number => {
    if (rank === null) return -1;
    if (rank === 1) return 15;
    return rank;
  };

  return [...cards].sort((a, b) => {
    const colorDiff = colorOrder[a.color] - colorOrder[b.color];
    if (colorDiff !== 0) return colorDiff;
    return getRankValue(b.rank) - getRankValue(a.rank);
  });
};

// Get color symbol for display
const getColorSymbol = (color: string): string => {
  switch (color) {
    case 'Green': return '●';
    case 'Red': return '●';
    case 'Yellow': return '●';
    case 'Black': return '●';
    default: return '♜';
  }
};

// Component for rendering a single card
const CardComponent: React.FC<{ card: Card; onClick?: () => void }> = ({ card, onClick }) => {
  const colorClass = card.color.toLowerCase();
  const isRook = card.color === 'Rook';

  return (
    <button className={`card ${colorClass}`} onClick={onClick} type="button">
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

// Component for a face-down card (simplified)
const CardBack: React.FC = () => (
  <div className="card card-back">
    <span className="back-pattern">♜</span>
  </div>
);

// Player info component
interface PlayerInfoProps {
  name: string;
  cardCount: number;
  position: 'top' | 'left' | 'right';
  isPartner?: boolean;
  isCurrentTurn?: boolean;
}

const PlayerInfo: React.FC<PlayerInfoProps> = ({ 
  name, 
  cardCount, 
  position, 
  isPartner,
  isCurrentTurn 
}) => (
  <div className={`player-info player-${position} ${isPartner ? 'partner' : ''} ${isCurrentTurn ? 'current-turn' : ''}`}>
    <div className="player-avatar">
      {name[0].toUpperCase()}
    </div>
    <div className="player-details">
      <span className="player-name">{name}</span>
      {isPartner && <span className="partner-badge">Partner</span>}
    </div>
    <div className="player-card-count">
      <CardBack />
      <span className="count">{cardCount}</span>
    </div>
  </div>
);

// Trick area with played cards
const TrickArea: React.FC = () => (
  <div className="trick-area">
    <div className="trick-center">
      <span className="trick-label">Play Area</span>
    </div>
    {/* Card slots for each player position */}
    <div className="trick-slot slot-top"></div>
    <div className="trick-slot slot-left"></div>
    <div className="trick-slot slot-right"></div>
    <div className="trick-slot slot-bottom"></div>
  </div>
);

// Kitty display
const KittyDisplay: React.FC<{ cardCount: number }> = ({ cardCount }) => (
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

// Partner Selection Modal Component
interface PartnerSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  players: Player[];
  gameId: string;
  onPartnerSelected: () => void;
}

const PartnerSelectionModal: React.FC<PartnerSelectionModalProps> = ({ 
  isOpen, 
  onClose, 
  players, 
  gameId,
  onPartnerSelected 
}) => {
  const [isSelectingPartner, setIsSelectingPartner] = useState(false);
  
  // Get other players (not the host)
  const otherPlayers = players.filter(p => p.seat !== 0);
  
  // Handle partner selection
  const handleChoosePartner = async (partnerSeat: number) => {
    if (isSelectingPartner) return;
    
    setIsSelectingPartner(true);
    try {
      const response = await fetch(`${API_BASE_URL}/choosePartner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          partnerSeat,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to select partner');
      }

      console.log('Partner selected:', data);
      
      // Close modal and refresh game state
      onClose();
      onPartnerSelected();
    } catch (error) {
      console.error('Error selecting partner:', error);
      alert(error instanceof Error ? error.message : 'Failed to select partner');
    } finally {
      setIsSelectingPartner(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Choose Your Partner</h2>
          <button className="modal-close" onClick={onClose} type="button">×</button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">Select one player to be your teammate</p>
          <div className="partner-options">
            {otherPlayers.map(player => (
              <button
                key={player.seat}
                type="button"
                className="partner-btn"
                onClick={() => handleChoosePartner(player.seat)}
                disabled={isSelectingPartner}
              >
                <div className="partner-avatar">{player.name[0].toUpperCase()}</div>
                <div className="partner-name">{player.name}</div>
                {isSelectingPartner && <div className="partner-loading">...</div>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Waiting Lobby Component (shown when waiting for players)
interface WaitingLobbyProps {
  gameState: GameState;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPartnerSelected?: () => void;
}

const WaitingLobby: React.FC<WaitingLobbyProps> = ({ gameState, onRefresh, isRefreshing, onPartnerSelected }) => {
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

        {/* Start Game button - only show if game is FULL and user is host */}
        {gameState.status === 'FULL' && gameState.isHost && gameState.players.length === 4 && (
          <button 
            type="button"
            className="start-game-btn"
            onClick={() => setShowPartnerModal(true)}
          >
            🎮 Start Game
          </button>
        )}

        {/* Waiting message for non-hosts when game is full */}
        {gameState.status === 'FULL' && !gameState.isHost && (
          <div className="waiting-message">
            <p>⏳ Waiting for host to start the game...</p>
          </div>
        )}

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

        <Link to="/" className="leave-btn">
          ← Leave Game
        </Link>
      </div>
    </div>
  );
};

const GamePage: React.FC = () => {
  const location = useLocation();
  const sortedHand = sortCards(userHand);
  
  // Initialize game state from navigation state or localStorage
  const [gameState, setGameState] = useState<GameState>(() => {
    // Try to get from navigation state first
    const navState = location.state as Partial<GameState> | null;
    
    if (navState?.gameId && navState?.playerName !== undefined) {
      return {
        gameId: navState.gameId,
        playerName: navState.playerName,
        seat: navState.seat ?? 0,
        isHost: navState.isHost ?? false,
        players: navState.players ?? [],
        status: 'LOBBY',
      };
    }
    
    // Fall back to localStorage
    const storedGameId = localStorage.getItem('rook_gameId');
    const storedPlayerName = localStorage.getItem('rook_playerName');
    const storedSeat = localStorage.getItem('rook_seat');
    const storedIsHost = localStorage.getItem('rook_isHost');
    const storedPlayers = localStorage.getItem('rook_players');
    
    return {
      gameId: storedGameId || 'UNKNOWN',
      playerName: storedPlayerName || 'Player',
      seat: storedSeat ? parseInt(storedSeat, 10) : 0,
      isHost: storedIsHost === 'true',
      players: storedPlayers ? JSON.parse(storedPlayers) : [],
      status: 'LOBBY',
    };
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Polling to refresh game state
  const refreshGameState = useCallback(async () => {
    if (!gameState.gameId || gameState.gameId === 'UNKNOWN') return;
    
    setIsRefreshing(true);
    try {
      // Use the games endpoint to get current state
      const response = await fetch(`${API_BASE_URL}/games`);
      const data = await response.json();
      
      // Find our game
      const game = data.games?.find((g: any) => g.gameId === gameState.gameId);
      
      if (game) {
        setGameState(prev => ({
          ...prev,
          players: game.players || [],
          status: game.status || prev.status,
          teams: game.teams || null,
        }));
        
        // Update localStorage
        localStorage.setItem('rook_players', JSON.stringify(game.players));
        if (game.teams) {
          localStorage.setItem('rook_teams', JSON.stringify(game.teams));
        }
      }
    } catch (error) {
      console.error('Error refreshing game state:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [gameState.gameId]);

  // Auto-refresh every 3 seconds while in LOBBY/FULL/PARTNER_SELECTION status
  useEffect(() => {
    if (gameState.status === 'LOBBY' || gameState.status === 'FULL' || gameState.status === 'PARTNER_SELECTION') {
      const interval = setInterval(refreshGameState, 3000);
      return () => clearInterval(interval);
    }
  }, [gameState.status, refreshGameState]);

  // Initial refresh on mount
  useEffect(() => {
    refreshGameState();
  }, [refreshGameState]);

  // Show waiting lobby if game is not yet in playing state
  if (gameState.status === 'LOBBY' || gameState.status === 'FULL' || gameState.status === 'PARTNER_SELECTION') {
    return (
      <WaitingLobby 
        gameState={gameState} 
        onRefresh={refreshGameState}
        isRefreshing={isRefreshing}
        onPartnerSelected={refreshGameState}
      />
    );
  }

  // Show the game table when playing
  return (
    <div className="game-container">
      {/* Compact header */}
      <header className="game-header">
        <Link to="/" className="back-btn" aria-label="Leave game">
          ←
        </Link>
        <div className="game-status">
          <span className="game-code">{gameState.gameId}</span>
          <div className="game-stats">
            <span className="stat">Bid: <strong>--</strong></span>
            <span className="stat">Trump: <strong>--</strong></span>
          </div>
        </div>
        <div className="connection-status connected">
          <span className="status-dot"></span>
          <span className="status-text">Connected</span>
        </div>
      </header>

      <main className="game-table">
        {/* Top opponent (across from user) - this is the partner */}
        <section className="table-section table-top">
          <PlayerInfo 
            name={gameState.players.find(p => p.seat === 2)?.name || 'Player 3'}
            cardCount={13} 
            position="top" 
            isPartner={true}
          />
        </section>

        {/* Middle section: side players + play area */}
        <section className="table-section table-middle">
          <PlayerInfo 
            name={gameState.players.find(p => p.seat === 1)?.name || 'Player 2'}
            cardCount={13} 
            position="left" 
            isCurrentTurn={true}
          />
          
          <div className="center-area">
            <TrickArea />
            <KittyDisplay cardCount={5} />
          </div>

          <PlayerInfo 
            name={gameState.players.find(p => p.seat === 3)?.name || 'Player 4'}
            cardCount={13} 
            position="right" 
          />
        </section>

        {/* Bottom: local player's hand */}
        <section className="table-section table-bottom">
          <div className="local-player">
            <div className="local-player-header">
              <div className="local-avatar">You</div>
              <span className="local-name">{gameState.playerName}</span>
              <span className="card-count-badge">{sortedHand.length} cards</span>
            </div>
            <div className="hand-container">
              <div className="hand-scroll">
                {sortedHand.map((card, index) => (
                  <CardComponent 
                    key={index} 
                    card={card}
                    onClick={() => console.log('Played:', card)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default GamePage;
