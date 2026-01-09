// Utility functions for localStorage operations
import { GameState, Player } from '../types/game';

export const localStorageUtils = {
  /**
   * Save game state to localStorage
   */
  saveGameState(gameId: string, playerName: string, seat: number, isHost: boolean, players: Player[]): void {
    localStorage.setItem('rook_gameId', gameId);
    localStorage.setItem('rook_playerName', playerName);
    localStorage.setItem('rook_seat', seat.toString());
    localStorage.setItem('rook_isHost', isHost ? 'true' : 'false');
    localStorage.setItem('rook_players', JSON.stringify(players));
  },

  /**
   * Get game state from localStorage
   */
  getGameState(): Partial<GameState> | null {
    const gameId = localStorage.getItem('rook_gameId');
    const playerName = localStorage.getItem('rook_playerName');
    const seat = localStorage.getItem('rook_seat');
    const isHost = localStorage.getItem('rook_isHost');
    const players = localStorage.getItem('rook_players');

    if (!gameId || !playerName) {
      return null;
    }

    return {
      gameId,
      playerName,
      seat: seat ? parseInt(seat, 10) : 0,
      isHost: isHost === 'true',
      players: players ? JSON.parse(players) : [],
    };
  },
};
