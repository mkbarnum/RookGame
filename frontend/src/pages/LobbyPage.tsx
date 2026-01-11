import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { gameApi } from '../services/gameApi';
import { localStorageUtils, CardSortMethod } from '../utils/localStorage';
import { SettingsModal } from '../components';
import rookIcon from '../assets/cards/rook.png';
import './LobbyPage.css';

const LobbyPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [playerName, setPlayerName] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoJoined, setHasAutoJoined] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cardSortMethod, setCardSortMethod] = useState<CardSortMethod>(() => localStorageUtils.getCardSortMethod());
  const navigate = useNavigate();

  const handleCardSortMethodChange = (method: CardSortMethod) => {
    setCardSortMethod(method);
    localStorageUtils.saveCardSortMethod(method);
  };

  // Pre-fill game code from URL parameter
  useEffect(() => {
    const urlGameId = searchParams.get('gameId');
    if (urlGameId && !gameCode) {
      setGameCode(urlGameId.toUpperCase());
    }
  }, [searchParams, gameCode]);

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
      // Clear any old game state before creating a new game
      localStorageUtils.clearGameState();
      
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
      // Clear any old game state before joining a new game
      localStorageUtils.clearGameState();
      
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
      <button
        className="settings-btn lobby-settings-btn"
        onClick={() => setShowSettings(true)}
        aria-label="Settings"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <div className="lobby-card">
        <div className="lobby-header">
          <div className="rook-icon">
            <img src={rookIcon} alt="Rook" />
          </div>
          <h1>Hwang Rook</h1>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="lobby-form">
          <div className="input-group">
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

export default LobbyPage;
