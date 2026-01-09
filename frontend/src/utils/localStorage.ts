// Utility functions for localStorage operations
import { GameState, Player } from '../types/game';

export type CardSortMethod = 'left-to-right' | 'left-to-right-goofy' | 'right-to-left';

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

  /**
   * Save card sort method preference
   */
  saveCardSortMethod(method: CardSortMethod): void {
    localStorage.setItem('rook_cardSortMethod', method);
  },

  /**
   * Get card sort method preference (defaults to 'left-to-right')
   */
  getCardSortMethod(): CardSortMethod {
    const method = localStorage.getItem('rook_cardSortMethod');
    if (method === 'left-to-right' || method === 'left-to-right-goofy' || method === 'right-to-left') {
      return method;
    }
    return 'left-to-right';
  },
};
