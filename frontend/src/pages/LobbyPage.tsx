import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { gameApi } from '../services/gameApi';
import { localStorageUtils } from '../utils/localStorage';
import './LobbyPage.css';

const LobbyPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [playerName, setPlayerName] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoJoined, setHasAutoJoined] = useState(false);
  const navigate = useNavigate();

  // Auto-join functionality: fill form fields and click button
  useEffect(() => {
    const autoJoin = searchParams.get('autoJoin');
    const urlGameId = searchParams.get('gameId');
    const urlPlayerName = searchParams.get('playerName');
    const isHost = searchParams.get('isHost') === 'true';

    if (autoJoin === 'true' && urlPlayerName && !hasAutoJoined) {
      setHasAutoJoined(true);

      // Fill in the form fields
      setPlayerName(urlPlayerName);
      if (urlGameId) {
        setGameCode(urlGameId);
      }

      // Wait a moment for form to render, then automatically click the appropriate button
      const timer = setTimeout(() => {
        if (isHost) {
          handleCreateGame(urlPlayerName);
        } else if (urlGameId) {
          handleJoinGame(urlPlayerName, urlGameId);
        }
      }, 800);

      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, hasAutoJoined]);

  const handleCreateGame = async (nameOverride?: string) => {
    const name = nameOverride || playerName.trim();
    if (!name) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await gameApi.createGame(name);

      // Store game info in localStorage
      localStorageUtils.saveGameState(data.gameId, name, data.seat, true, data.game.players);

      console.log('Created game:', data.gameId);

      // Navigate to game page
      navigate('/game', {
        state: {
          playerName: name,
          gameId: data.gameId,
          seat: data.seat,
          isHost: true,
          players: data.game.players,
        },
      });
    } catch (err) {
      console.error('Error creating game:', err);
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinGame = async (nameOverride?: string, codeOverride?: string) => {
    const name = nameOverride || playerName.trim();
    const code = codeOverride || gameCode.trim();

    console.log('Join Game clicked!', { name, code, isLoading });

    if (!name || !code) {
      console.log('Validation failed - name or code empty');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('Fetching:', `${gameApi}`);
      const data = await gameApi.joinGame(code, name);

      // Store game info in localStorage
      localStorageUtils.saveGameState(data.gameId, name, data.seat, false, data.players);

      console.log('Joined game:', data.gameId, 'at seat:', data.seat);

      // Navigate to game page
      navigate('/game', {
        state: {
          playerName: name,
          gameId: data.gameId,
          seat: data.seat,
          isHost: false,
          players: data.players,
        },
      });
    } catch (err) {
      // If error is "name taken" or "already in the game", automatically log them in
      const errorMessage = err instanceof Error ? err.message : 'Failed to join game';
      if (
        errorMessage.includes('already in the game') ||
        errorMessage.includes('Name taken') ||
        errorMessage.includes('name is already in the game')
      ) {
        console.log(`Name "${name}" already exists in game, logging in automatically...`);

        // Try to find the player and auto-login
        const existingPlayer = await gameApi.findPlayerInGame(code, name);
        if (existingPlayer) {
          const gamesData = await gameApi.getAllGames();
          const game = gamesData.games?.find((g: any) => g.gameId === code.toUpperCase());
          if (game) {
            localStorageUtils.saveGameState(game.gameId, name, existingPlayer.seat, existingPlayer.seat === 0, game.players);

            navigate('/game', {
              state: {
                playerName: name,
                gameId: game.gameId,
                seat: existingPlayer.seat,
                isHost: existingPlayer.seat === 0,
                players: game.players,
              },
            });
            setIsLoading(false);
            return;
          }
        }
        // If we can't find the player, show a helpful message
        setError(`Name "${name}" is already taken in this game. Please use a different name.`);
      } else {
        setError(errorMessage);
      }
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

        {error && <div className="error-message">{error}</div>}

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
            onClick={() => handleCreateGame()}
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
              onClick={() => handleJoinGame()}
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
