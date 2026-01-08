import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './LobbyPage.css';

const LobbyPage: React.FC = () => {
  const [playerName, setPlayerName] = useState('');
  const [gameCode, setGameCode] = useState('');
  const navigate = useNavigate();

  const handleCreateGame = () => {
    // TODO: Implement actual game creation logic with backend
    console.log('Creating game for player:', playerName);
    // For now, navigate to game page with player name
    navigate('/game', { state: { playerName, isHost: true } });
  };

  const handleJoinGame = () => {
    // TODO: Implement actual game joining logic with backend
    console.log('Joining game:', gameCode, 'as player:', playerName);
    // For now, navigate to game page with player name and game code
    navigate('/game', { state: { playerName, gameCode, isHost: false } });
  };

  return (
    <div className="lobby-container">
      <div className="lobby-card">
        <div className="lobby-header">
          <div className="rook-icon">♜</div>
          <h1>Rook Online</h1>
          <p className="subtitle">Multiplayer Card Game</p>
        </div>

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
            />
          </div>

          <div className="divider">
            <span>Start Playing</span>
          </div>

          <button 
            className="btn btn-primary"
            onClick={handleCreateGame}
            disabled={!playerName.trim()}
          >
            Create New Game
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
              />
            </div>
            <button 
              className="btn btn-secondary"
              onClick={handleJoinGame}
              disabled={!playerName.trim() || !gameCode.trim()}
            >
              Join Game
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
