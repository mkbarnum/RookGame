import { useEffect, useRef, useState, useCallback } from 'react';
import { buildWebSocketUrl } from '../config';
import { GameState, Card, WebSocketMessage } from '../types/game';
import { parseCard } from '../utils/cardUtils';

interface UseWebSocketProps {
  gameState: GameState;
  onDeal: (cards: Card[]) => void;
  onSeatsRearranged: (players: any[], teams: any) => void;
  onBiddingStart: (startingPlayer: number, minBid: number) => void;
  onBidPlaced: (amount: number, seat: number) => void;
  onPlayerPassed: (seat: number) => void;
  onNextBidder: (seat: number) => void;
  onKitty: (cards: Card[]) => void;
  onBiddingWon: (winner: number, amount: number) => void;
  onTrumpChosen: (suit: string) => void;
  onPlayStart: (leader: number) => void;
  onCardPlayed: (seat: number, card: string) => void;
  onNextPlayer: (seat: number) => void;
  onTrickWon: (winner: number, points: number) => void;
  onHandComplete: (message: any) => void;
  onGameOver: (message: any) => void;
  onError: (action: string, message: string) => void;
}

export const useWebSocket = ({
  gameState,
  onDeal,
  onSeatsRearranged,
  onBiddingStart,
  onBidPlaced,
  onPlayerPassed,
  onNextBidder,
  onKitty,
  onBiddingWon,
  onTrumpChosen,
  onPlayStart,
  onCardPlayed,
  onNextPlayer,
  onTrickWon,
  onHandComplete,
  onGameOver,
  onError,
}: UseWebSocketProps) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // Store callbacks in refs to avoid recreating WebSocket on every render
  const callbacksRef = useRef({
    onDeal,
    onSeatsRearranged,
    onBiddingStart,
    onBidPlaced,
    onPlayerPassed,
    onNextBidder,
    onKitty,
    onBiddingWon,
    onTrumpChosen,
    onPlayStart,
    onCardPlayed,
    onNextPlayer,
    onTrickWon,
    onHandComplete,
    onGameOver,
    onError,
  });

  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = {
      onDeal,
      onSeatsRearranged,
      onBiddingStart,
      onBidPlaced,
      onPlayerPassed,
      onNextBidder,
      onKitty,
      onBiddingWon,
      onTrumpChosen,
      onPlayStart,
      onCardPlayed,
      onNextPlayer,
      onTrickWon,
      onHandComplete,
      onGameOver,
      onError,
    };
  }, [
    onDeal,
    onSeatsRearranged,
    onBiddingStart,
    onBidPlaced,
    onPlayerPassed,
    onNextBidder,
    onKitty,
    onBiddingWon,
    onTrumpChosen,
    onPlayStart,
    onCardPlayed,
    onNextPlayer,
    onTrickWon,
    onHandComplete,
    onGameOver,
    onError,
  ]);

  const sendMessage = useCallback((message: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        console.log('WebSocket message sent:', message);
        return true;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        return false;
      }
    } else {
      console.warn('WebSocket not connected. State:', ws?.readyState, 'Message:', message);
      return false;
    }
  }, []);

  useEffect(() => {
    // Connect when game is FULL, PARTNER_SELECTION, BIDDING, TRUMP_SELECTION, or PLAYING
    if (
      gameState.status !== 'FULL' &&
      gameState.status !== 'PARTNER_SELECTION' &&
      gameState.status !== 'BIDDING' &&
      gameState.status !== 'TRUMP_SELECTION' &&
      gameState.status !== 'PLAYING'
    ) {
      return;
    }

    if (!gameState.gameId || gameState.gameId === 'UNKNOWN') {
      return;
    }

    // Build WebSocket URL
    const wsUrl = buildWebSocketUrl(gameState.gameId, gameState.playerName, gameState.seat);
    console.log('Connecting to WebSocket:', wsUrl);

    // Create WebSocket connection
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('Received WebSocket message:', message);

        // Use callbacks from ref to get latest versions
        const callbacks = callbacksRef.current;

        switch (message.action) {
          case 'deal':
            if (message.cards && Array.isArray(message.cards)) {
              const cards = message.cards.map(parseCard);
              callbacks.onDeal(cards);
            }
            break;

          case 'seatsRearranged':
            if (message.players && Array.isArray(message.players)) {
              callbacks.onSeatsRearranged(message.players, message.teams);
            }
            break;

          case 'biddingStart':
            callbacks.onBiddingStart(
              message.startingPlayer !== undefined ? message.startingPlayer : 0,
              message.minBid || 50
            );
            break;

          case 'bidPlaced':
            callbacks.onBidPlaced(message.amount, message.seat);
            break;

          case 'playerPassed':
            callbacks.onPlayerPassed(message.seat);
            break;

          case 'nextBidder':
            callbacks.onNextBidder(message.seat);
            break;

          case 'kitty':
            if (message.cards && Array.isArray(message.cards)) {
              const kittyCards = message.cards.map(parseCard);
              callbacks.onKitty(kittyCards);
            }
            break;

          case 'biddingWon':
            callbacks.onBiddingWon(message.winner, message.amount);
            break;

          case 'trumpChosen':
            if (message.suit) {
              callbacks.onTrumpChosen(message.suit);
            }
            break;

          case 'playStart':
            if (message.leader !== undefined) {
              callbacks.onPlayStart(message.leader);
            }
            break;

          case 'cardPlayed':
            callbacks.onCardPlayed(message.seat, message.card);
            break;

          case 'nextPlayer':
            callbacks.onNextPlayer(message.seat);
            break;

          case 'trickWon':
            callbacks.onTrickWon(message.winner, message.points);
            break;

          case 'handComplete':
            callbacks.onHandComplete(message);
            break;

          case 'gameOver':
            callbacks.onGameOver(message);
            break;

          case 'bidError':
          case 'discardError':
          case 'cardError':
            callbacks.onError(message.action, message.message || 'An error occurred');
            break;

          default:
            console.log('Unknown message action:', message.action);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnected(false);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    };

    // Cleanup on unmount or when dependencies change
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [
    gameState.gameId,
    gameState.playerName,
    gameState.status,
    gameState.seat,
    // Note: callbacks are not in dependencies - they're stored in refs
  ]);

  return { sendMessage, connected };
};
