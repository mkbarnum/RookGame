import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import './LobbyPage.css';

interface Player {
  seat: number;
  name: string;
}

interface CreateGameResponse {
  success: boolean;
  gameId: string;
  seat: number;
  game: {
    gameId: string;
    hostName: string;
    players: Player[];
    status: string;
  };
  error?: string;
  message?: string;
}

interface JoinGameResponse {
  success: boolean;
  gameId: string;
  seat: number;
  players: Player[];
  status: string;
  hostName: string;
  error?: string;
  message?: string;
}

const LobbyPage: React.FC = () => {
  const [playerName, setPlayerName] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleCreateGame = async () => {
    if (!playerName.trim()) return;
    
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/createGame`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ hostName: playerName.trim() }),
      });

      const data: CreateGameResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to create game');
      }

      // Store game info in localStorage for the game page
      localStorage.setItem('rook_gameId', data.gameId);
      localStorage.setItem('rook_playerName', playerName.trim());
      localStorage.setItem('rook_seat', data.seat.toString());
      localStorage.setItem('rook_isHost', 'true');
      localStorage.setItem('rook_players', JSON.stringify(data.game.players));

      console.log('Created game:', data.gameId);
      
      // Navigate to game page
      navigate('/game', { 
        state: { 
          playerName: playerName.trim(), 
          gameId: data.gameId,
          seat: data.seat,
          isHost: true,
          players: data.game.players,
        } 
      });
    } catch (err) {
      console.error('Error creating game:', err);
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinGame = async () => {
    console.log('Join Game clicked!', { playerName, gameCode, isLoading });
    
    if (!playerName.trim() || !gameCode.trim()) {
      console.log('Validation failed - name or code empty');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('Fetching:', `${API_BASE_URL}/joinGame`);
      const response = await fetch(`${API_BASE_URL}/joinGame`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          gameId: gameCode.trim().toUpperCase(), 
          playerName: playerName.trim() 
        }),
      });

      const data: JoinGameResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to join game');
      }

      // Store game info in localStorage for the game page
      localStorage.setItem('rook_gameId', data.gameId);
      localStorage.setItem('rook_playerName', playerName.trim());
      localStorage.setItem('rook_seat', data.seat.toString());
      localStorage.setItem('rook_isHost', 'false');
      localStorage.setItem('rook_players', JSON.stringify(data.players));

      console.log('Joined game:', data.gameId, 'at seat:', data.seat);

      // Navigate to game page
      navigate('/game', { 
        state: { 
          playerName: playerName.trim(), 
          gameId: data.gameId,
          seat: data.seat,
          isHost: false,
          players: data.players,
        } 
      });
    } catch (err) {
      console.error('Error joining game:', err);
      setError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="lobby-container">
      <div className="lobby-card">
        <div className="lobby-header">
          <div className="rook-icon">♜</div>
          <h1>Rook Online</h1>
          <p className="subtitle">Multiplayer Card Game</p>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <div className="lobby-form">
          <div className="input-group">
            <label htmlFor="playerName">Your Name</label>
            <input
              type="text"
              id="playerName"
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={20}
              disabled={isLoading}
            />
          </div>

          <div className="divider">
            <span>Start Playing</span>
          </div>

          <button 
            type="button"
            className="btn btn-primary"
            onClick={handleCreateGame}
            disabled={!playerName.trim() || isLoading}
          >
            {isLoading ? 'Creating...' : 'Create New Game'}
          </button>

          <div className="divider">
            <span>or</span>
          </div>

          <div className="join-section">
            <div className="input-group">
              <label htmlFor="gameCode">Game Code</label>
              <input
                type="text"
                id="gameCode"
                placeholder="Enter game code"
                value={gameCode}
                onChange={(e) => setGameCode(e.target.value.toUpperCase())}
                maxLength={6}
                disabled={isLoading}
              />
            </div>
            <button 
              type="button"
              className="btn btn-secondary"
              onClick={handleJoinGame}
              disabled={!playerName.trim() || !gameCode.trim() || isLoading}
            >
              {isLoading ? 'Joining...' : 'Join Game'}
            </button>
          </div>
        </div>

        <div className="lobby-footer">
          <p>Play Rook with friends anywhere!</p>
        </div>
      </div>
    </div>
  );
};

export default LobbyPage;
