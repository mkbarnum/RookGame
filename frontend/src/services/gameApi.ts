// API service for game operations
import { API_BASE_URL } from '../config';
import { CreateGameResponse, JoinGameResponse, Player } from '../types/game';

export const gameApi = {
  /**
   * Create a new game
   */
  async createGame(hostName: string): Promise<CreateGameResponse> {
    const response = await fetch(`${API_BASE_URL}/createGame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ hostName }),
    });

    const data: CreateGameResponse = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Failed to create game');
    }

    return data;
  },

  /**
   * Join an existing game
   */
  async joinGame(gameId: string, playerName: string): Promise<JoinGameResponse> {
    const response = await fetch(`${API_BASE_URL}/joinGame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gameId: gameId.toUpperCase(),
        playerName,
      }),
    });

    const data: JoinGameResponse = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Failed to join game');
    }

    return data;
  },

  /**
   * Get all games (for debugging/state refresh)
   */
  async getAllGames(): Promise<{ games: any[] }> {
    const response = await fetch(`${API_BASE_URL}/games`);
    if (!response.ok) {
      throw new Error('Failed to fetch games');
    }
    return response.json();
  },

  /**
   * Find a player in a game by name (for auto-login)
   */
  async findPlayerInGame(gameId: string, playerName: string): Promise<Player | null> {
    try {
      const gamesData = await this.getAllGames();
      const game = gamesData.games?.find((g: any) => g.gameId === gameId.toUpperCase());
      if (game) {
        const player = game.players?.find((p: Player) => p.name.toLowerCase() === playerName.toLowerCase());
        return player || null;
      }
      return null;
    } catch (error) {
      console.error('Error finding player:', error);
      return null;
    }
  },
};
