import { useEffect, useRef, useState, useCallback } from 'react';
import { buildWebSocketUrl } from '../config';
import { GameState, Card, WebSocketMessage } from '../types/game';
import { parseCard } from '../utils/cardUtils';

// Reconnection configuration
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds

interface UseWebSocketProps {
  gameState: GameState;
  onPlayerJoined?: (player: any, players: any[], status: string) => void;
  onDeal: (cards: Card[]) => void;
  onSeatsRearranged: (players: any[], teams: any) => void;
  onBiddingStart: (startingPlayer: number, minBid: number) => void;
  onBidPlaced: (amount: number, seat: number, nextBidder?: number) => void;
  onPlayerPassed: (seat: number, nextBidder?: number) => void;
  onNextBidder: (seat: number) => void;
  onKitty: (cards: Card[]) => void;
  onBiddingWon: (winner: number, amount: number) => void;
  onTrumpChosen: (suit: string, leader?: number) => void;
  onPlayStart: (leader: number) => void;
  onCardPlayed: (seat: number, card: string, nextPlayer?: number) => void;
  onNextPlayer: (seat: number) => void;
  onTrickWon: (winner: number, points: number) => void;
  onHandComplete: (message: any) => void;
  onGameOver: (message: any) => void;
  onGameReset: (message: any) => void;
  onError: (action: string, message: string) => void;
  onQuickChat: (seat: number, message: string) => void;
  onResync?: (message: any) => void;
}

export const useWebSocket = ({
  gameState,
  onPlayerJoined,
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
  onGameReset,
  onError,
  onQuickChat,
  onResync,
}: UseWebSocketProps) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  // Track the connection key (gameId:playerName) to detect actual reconnection needs
  const connectionKeyRef = useRef<string | null>(null);
  
  // Reconnection state
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intentionalCloseRef = useRef(false);
  const isReconnectingRef = useRef(false);

  // Store callbacks in refs to avoid recreating WebSocket on every render
  const callbacksRef = useRef({
    onPlayerJoined,
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
    onGameReset,
    onError,
    onQuickChat,
    onResync,
  });

  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = {
      onPlayerJoined,
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
      onGameReset,
      onError,
      onQuickChat,
      onResync,
    };
  }, [
    onPlayerJoined,
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
    onGameReset,
    onError,
    onQuickChat,
    onResync,
  ]);

  // Store gameState in ref for use in callbacks
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const sendMessage = useCallback((message: object) => {
    // Always read from ref to get the latest WebSocket instance
    const ws = wsRef.current;
    if (!ws) {
      console.warn('[WS] No WebSocket reference. Message:', message);
      console.warn('[WS] Connection key:', connectionKeyRef.current);
      return false;
    }
    
    const readyState = ws.readyState;
    const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const stateName = stateNames[readyState] || `UNKNOWN(${readyState})`;
    
    if (readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        console.log('[WS] Message sent:', message);
        return true;
      } catch (error) {
        console.error('[WS] Error sending message:', error, 'Message:', message);
        return false;
      }
    } else {
      console.warn('[WS] WebSocket not open. State:', stateName, 'Message:', message);
      console.warn('[WS] Connection key:', connectionKeyRef.current);
      return false;
    }
  }, []); // No dependencies - uses ref which always has current value

  // Send resync request
  const sendResync = useCallback(() => {
    console.log('[WS] Sending resync request...');
    return sendMessage({ action: 'resync' });
  }, [sendMessage]);

  // Create WebSocket connection function (used for initial connect and reconnect)
  const createConnection = useCallback(() => {
    const currentGameState = gameStateRef.current;
    
    // Validate we should connect
    const shouldConnect = 
      currentGameState.status === 'LOBBY' ||
      currentGameState.status === 'FULL' ||
      currentGameState.status === 'PARTNER_SELECTION' ||
      currentGameState.status === 'BIDDING' ||
      currentGameState.status === 'TRUMP_SELECTION' ||
      currentGameState.status === 'PLAYING' ||
      currentGameState.status === 'FINISHED';

    if (!shouldConnect) {
      console.log('[WS] Not connecting - status not in allowed list:', currentGameState.status);
      return null;
    }

    if (!currentGameState.gameId || currentGameState.gameId === 'UNKNOWN') {
      console.log('[WS] Not connecting - invalid gameId:', currentGameState.gameId);
      return null;
    }

    // Build WebSocket URL
    const wsUrl = buildWebSocketUrl(currentGameState.gameId, currentGameState.playerName, currentGameState.seat);
    console.log('[WS] Connecting to WebSocket:', wsUrl);

    // Create WebSocket connection
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] ✓ WebSocket connected successfully for', currentGameState.playerName, 'in game', currentGameState.gameId);
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      
      // Send resync request immediately after connecting to get current game state
      // Use setTimeout to ensure the connection is fully established
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log('[WS] Sending resync after connection...');
          ws.send(JSON.stringify({ action: 'resync' }));
        }
      }, 100);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('Received WebSocket message:', message);

        // Use callbacks from ref to get latest versions
        const callbacks = callbacksRef.current;

        switch (message.action) {
          case 'playerJoined':
            if (callbacks.onPlayerJoined && message.players) {
              callbacks.onPlayerJoined(message.player, message.players, message.status);
            }
            break;

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
            // Pass nextBidder as third parameter if batched
            callbacks.onBidPlaced(message.amount, message.seat, message.nextBidder);
            // Also call onNextBidder separately for backward compatibility
            if (message.nextBidder !== undefined) {
              callbacks.onNextBidder(message.nextBidder);
            }
            break;

          case 'playerPassed':
            // Pass nextBidder as second parameter if batched
            callbacks.onPlayerPassed(message.seat, message.nextBidder);
            // Also call onNextBidder separately for backward compatibility
            if (message.nextBidder !== undefined) {
              callbacks.onNextBidder(message.nextBidder);
            }
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
              // Pass leader as second parameter if batched
              callbacks.onTrumpChosen(message.suit, message.leader);
            }
            // Also call onPlayStart separately for backward compatibility
            if (message.leader !== undefined) {
              callbacks.onPlayStart(message.leader);
            }
            break;

          case 'playStart':
            if (message.leader !== undefined) {
              callbacks.onPlayStart(message.leader);
            }
            break;

          case 'cardPlayed':
            // Pass nextPlayer as third parameter if batched
            callbacks.onCardPlayed(message.seat, message.card, message.nextPlayer);
            // Also call onNextPlayer separately for backward compatibility
            if (message.nextPlayer !== undefined) {
              callbacks.onNextPlayer(message.nextPlayer);
            }
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

          case 'gameReset':
            callbacks.onGameReset(message);
            break;

          case 'quickChat':
            if (message.seat !== undefined && message.message) {
              callbacks.onQuickChat(message.seat, message.message);
            }
            break;

          case 'resync':
            console.log('[WS] Received resync response:', message);
            if (callbacks.onResync) {
              callbacks.onResync(message);
            }
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
      console.error('[WS] ✗ WebSocket error for', currentGameState.playerName, ':', error);
      setConnected(false);
    };

    ws.onclose = (event) => {
      console.log('[WS] WebSocket disconnected for', currentGameState.playerName, '- code:', event.code, 'reason:', event.reason);
      setConnected(false);
      
      // Only clear the ref if this was the active connection
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // Attempt reconnection if not intentionally closed
      if (!intentionalCloseRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current),
          MAX_RECONNECT_DELAY
        );
        
        console.log(`[WS] Scheduling reconnect attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!intentionalCloseRef.current) {
            reconnectAttemptsRef.current++;
            isReconnectingRef.current = true;
            console.log(`[WS] Attempting reconnect ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}...`);
            const newWs = createConnection();
            if (newWs) {
              wsRef.current = newWs;
            }
          }
        }, delay);
      } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[WS] Max reconnection attempts reached. Please refresh the page.');
      }
    };

    return ws;
  }, []);

  // Handle visibility change - resync when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WS] Tab became visible, checking connection...');
        
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          // Connection is still open, just resync to get fresh state
          console.log('[WS] Connection active, sending resync...');
          sendResync();
        } else if (ws && (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED)) {
          // Connection is closed, trigger reconnection
          console.log('[WS] Connection closed, triggering reconnection...');
          reconnectAttemptsRef.current = 0;
          intentionalCloseRef.current = false;
          const newWs = createConnection();
          if (newWs) {
            wsRef.current = newWs;
          }
        } else if (!ws) {
          // No WebSocket reference, create new connection
          console.log('[WS] No connection, creating new one...');
          const newWs = createConnection();
          if (newWs) {
            wsRef.current = newWs;
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sendResync, createConnection]);

  // This effect ONLY handles connection lifecycle based on core connection params
  // Status and seat are NOT dependencies - we don't want to reconnect when they change
  useEffect(() => {
    // Connection key only includes gameId and playerName - NOT seat
    // Seat can change during seatsRearranged but we should keep the same connection
    const connectionKey = `${gameState.gameId}:${gameState.playerName}`;
    
    console.log('[WS] Connection effect triggered:', {
      gameId: gameState.gameId,
      playerName: gameState.playerName,
      seat: gameState.seat,
      status: gameState.status,
      connectionKey,
      previousKey: connectionKeyRef.current,
      currentWsState: wsRef.current?.readyState,
    });

    // CRITICAL: If we already have an active connection with same key, don't reconnect!
    // This prevents reconnection when the effect is triggered by other state changes
    const existingWs = wsRef.current;
    if (connectionKeyRef.current === connectionKey && 
        existingWs && 
        (existingWs.readyState === WebSocket.OPEN || 
         existingWs.readyState === WebSocket.CONNECTING)) {
      console.log('[WS] Already connected with same key, skipping reconnection');
      console.log('[WS] Current WebSocket state:', existingWs.readyState);
      // Return a cleanup that only closes if this specific WebSocket is still active
      return () => {
        // Mark as intentional close on unmount
        intentionalCloseRef.current = true;
        
        // Clear any pending reconnect
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        
        // Only close if this is still the active WebSocket (not replaced)
        if (wsRef.current === existingWs && 
            (existingWs.readyState === WebSocket.OPEN || existingWs.readyState === WebSocket.CONNECTING)) {
          console.log('[WS] Cleanup: Closing existing connection (key changed or unmount)');
          existingWs.close();
          if (wsRef.current === existingWs) {
            wsRef.current = null;
          }
        } else {
          console.log('[WS] Cleanup skipped - connection was replaced or already closed');
        }
      };
    }

    // Check if we should connect (status is valid)
    const shouldConnect = 
      gameState.status === 'LOBBY' ||
      gameState.status === 'FULL' ||
      gameState.status === 'PARTNER_SELECTION' ||
      gameState.status === 'BIDDING' ||
      gameState.status === 'TRUMP_SELECTION' ||
      gameState.status === 'PLAYING' ||
      gameState.status === 'FINISHED';

    if (!shouldConnect) {
      console.log('[WS] Not connecting - status not in allowed list:', gameState.status);
      return;
    }

    if (!gameState.gameId || gameState.gameId === 'UNKNOWN') {
      console.log('[WS] Not connecting - invalid gameId:', gameState.gameId);
      return;
    }

    // Store the connection key
    connectionKeyRef.current = connectionKey;
    
    // Reset reconnection state for new connection
    intentionalCloseRef.current = false;
    reconnectAttemptsRef.current = 0;

    // Create WebSocket connection
    const ws = createConnection();
    if (ws) {
      wsRef.current = ws;
    }

    // Cleanup on unmount or when core connection params change
    return () => {
      console.log('[WS] Cleanup called for connection:', connectionKey);
      
      // Mark as intentional close
      intentionalCloseRef.current = true;
      
      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Only close if this is still the active connection
      const currentWs = wsRef.current;
      if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
        currentWs.close();
      }
      // Clear ref
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameState.gameId,
    gameState.playerName,
    createConnection,
    // NOTE: gameState.seat is intentionally NOT included!
    // When seatsRearranged is received, the seat changes but we should NOT reconnect.
    // The backend already sent deal/biddingStart to our current connection.
    // Reconnecting would cause us to miss those messages.
    //
    // NOTE: gameState.status is intentionally NOT included!
    // We don't want to reconnect when status changes (e.g., BIDDING → TRUMP_SELECTION)
    // This was causing the biddingWon message to be lost during reconnection
  ]);


  return { sendMessage, connected, sendResync };
};
