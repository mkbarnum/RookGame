// Type definitions for the Rook game

export interface Player {
  seat: number;
  name: string;
}

export interface Card {
  color: 'Green' | 'Red' | 'Yellow' | 'Black' | 'Rook';
  rank: number | null; // null for Rook card
}

export interface HandScore {
  round: number;
  bid: number;
  bidTeam: 'team0' | 'team1';
  madeBid: boolean;
  team0Points: number;
  team1Points: number;
  team0HandScore: number;
  team1HandScore: number;
  team0Total: number;
  team1Total: number;
  shootTheMoon: boolean;
}

export interface GameState {
  gameId: string;
  playerName: string;
  seat: number;
  isHost: boolean;
  players: Player[];
  status: string;
  teams?: { team0: number[]; team1: number[] } | null;
  trump?: string;
  currentPlayer?: number;
  bidWinner?: number;
  winningBid?: number;
  ledSuit?: string;
  currentTrick?: { seat: number; card: string }[];
  teamScores?: { team0: number; team1: number };
  handHistory?: HandScore[];
  dealer?: number;
}

export interface BiddingState {
  highBid: number | null;
  currentBidder: number | null;
  minBid: number;
}

export interface TrickWonNotification {
  winner: number;
  points: number;
}

export interface WebSocketMessage {
  action: string;
  [key: string]: any;
}

export interface CreateGameResponse {
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

export interface JoinGameResponse {
  success: boolean;
  gameId: string;
  seat: number;
  players: Player[];
  status: string;
  hostName: string;
  error?: string;
  message?: string;
}
