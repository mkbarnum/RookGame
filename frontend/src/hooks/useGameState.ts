import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { GameState, BiddingState } from '../types/game';

export const useGameState = () => {
  const location = useLocation();
  
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

  const [biddingState, setBiddingState] = useState<BiddingState>({
    highBid: null,
    currentBidder: null,
    minBid: 50,
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
          trump: game.trump || prev.trump,
          currentPlayer: game.currentPlayer,
          bidWinner: game.bidWinner,
          winningBid: game.winningBid,
          ledSuit: game.ledSuit,
          teamScores: game.teamScores || prev.teamScores,
          handHistory: game.handHistory || prev.handHistory,
        }));
        
        // Update bidding state if game is in bidding phase
        if (game.status === 'BIDDING') {
          setBiddingState({
            highBid: game.highBid !== undefined ? game.highBid : 0,
            currentBidder: game.currentBidder !== undefined ? game.currentBidder : 0,
            minBid: 50,
          });
        }
        
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

  return {
    gameState,
    setGameState,
    biddingState,
    setBiddingState,
    isRefreshing,
    refreshGameState,
  };
};
