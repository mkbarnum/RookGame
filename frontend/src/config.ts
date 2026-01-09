// Configuration constants for the Rook game application

// API Base URL - local development or production
export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

// WebSocket base URL - use local WebSocket server in development
// In production, this will be the AWS API Gateway WebSocket endpoint
const getWebSocketUrl = () => {
  if (process.env.REACT_APP_WS_BASE_URL) {
    return process.env.REACT_APP_WS_BASE_URL;
  }
  // In development, use the local WebSocket server
  const apiUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';
  const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
  return `${wsUrl}/ws`;
};

export const WS_BASE_URL = getWebSocketUrl();

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
export const buildWebSocketUrl = (gameId: string, playerName: string, seat?: number): string => {
  const params = new URLSearchParams({
    gameId,
    playerName,
  });
  if (seat !== undefined) {
    params.append('seat', seat.toString());
  }
  return `${WS_BASE_URL}?${params.toString()}`;
};
