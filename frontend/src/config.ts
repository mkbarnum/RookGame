// Configuration constants for the Rook game application

// API Base URL - local development or production
export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

// WebSocket base URL - will be replaced with actual AWS API Gateway WebSocket endpoint on deploy
export const WS_BASE_URL = process.env.REACT_APP_WS_BASE_URL || 'wss://example.com/dev';

// Helper to get game connection info from URL params or localStorage
export const getConnectionParams = (): { gameId: string; playerName: string } => {
  // Try URL params first
  const urlParams = new URLSearchParams(window.location.search);
  const urlGameId = urlParams.get('gameId');
  const urlPlayerName = urlParams.get('playerName');

  if (urlGameId && urlPlayerName) {
    return { gameId: urlGameId, playerName: urlPlayerName };
  }

  // Fall back to localStorage
  const storedGameId = localStorage.getItem('rook_gameId');
  const storedPlayerName = localStorage.getItem('rook_playerName');

  if (storedGameId && storedPlayerName) {
    return { gameId: storedGameId, playerName: storedPlayerName };
  }

  // Default dummy values for development/testing
  return { gameId: 'test-game-123', playerName: 'TestPlayer' };
};

// Build WebSocket URL with query parameters
export const buildWebSocketUrl = (gameId: string, playerName: string): string => {
  return `${WS_BASE_URL}?gameId=${encodeURIComponent(gameId)}&playerName=${encodeURIComponent(playerName)}`;
};
