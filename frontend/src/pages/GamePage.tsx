import React, { useState, useRef, useEffect } from 'react';
import { Card as CardType, TrickWonNotification } from '../types/game';
import { useGameState, useWebSocket } from '../hooks';
import {
  CardFan,
  PlayerInfo,
  TrickArea,
  KittyDisplay,
  DiscardUI,
  WaitingLobby,
  BiddingUI,
  TrickWonNotification as TrickWonNotificationComponent,
  RookOverlay,
  SettingsModal,
  CardSortMethod,
  Deck,
  QuickChatModal,
  QuickChatMessage,
} from '../components';
import { ScoresModal } from '../components/ScoresModal';
import { sortCards, isCardPlayable, cardToString, parseCard } from '../utils/cardUtils';
import { getAbsoluteSeat, isMyPartner } from '../utils/seatUtils';
import { localStorageUtils } from '../utils/localStorage';
import { API_BASE_URL } from '../config';
import './GamePage.css';

const GamePage: React.FC = () => {
  const {
    gameState,
    setGameState,
    biddingState,
    setBiddingState,
    isRefreshing,
    refreshGameState,
  } = useGameState();

  const [playerHand, setPlayerHand] = useState<CardType[]>([]);
  const [currentTrick, setCurrentTrick] = useState<{ seat: number; card: CardType }[]>([]);
  const [trickWonNotification, setTrickWonNotification] = useState<TrickWonNotification | null>(null);
  const [showScoresModal, setShowScoresModal] = useState(false);
  const [handHistory, setHandHistory] = useState<any[]>([]);
  const [gameWinner, setGameWinner] = useState<'team0' | 'team1' | null>(null);
  const [kittyCardStrings, setKittyCardStrings] = useState<Set<string>>(new Set());
  const [showRookOverlay, setShowRookOverlay] = useState(false);
  const rookOverlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [cardSortMethod, setCardSortMethod] = useState<CardSortMethod>(() => localStorageUtils.getCardSortMethod());
  const [isDealing, setIsDealing] = useState(false);
  const [dealtCardCount, setDealtCardCount] = useState(0);
  const [isFlipping, setIsFlipping] = useState(false);
  const [dealAnimationComplete, setDealAnimationComplete] = useState(false);
  const [showQuickChat, setShowQuickChat] = useState(false);
  const [quickChatMessages, setQuickChatMessages] = useState<Array<{ seat: number; message: string; timestamp: number }>>([]);
  const [bidMessages, setBidMessages] = useState<Map<number, string>>(new Map()); // Track bid messages per player (seat -> message)
  const previousStatusRef = useRef<string | undefined>(undefined);
  const hasAnimatedForCurrentHandRef = useRef<boolean>(false);
  const pendingCardPlaysRef = useRef<Set<string>>(new Set()); // Track cards currently being played to prevent duplicates

  const handleCardSortMethodChange = (method: CardSortMethod) => {
    setCardSortMethod(method);
    localStorageUtils.saveCardSortMethod(method);
  };

  const sortedHand = sortCards(playerHand, cardSortMethod);

  // Determine which team is "You + Partner" for scores display
  const myTeam = gameState.teams?.team0.includes(gameState.seat) ? 'team0' : 'team1';
  const myTeamScore = gameState.teamScores?.[myTeam] || 0;
  const opponentTeam = myTeam === 'team0' ? 'team1' : 'team0';
  const opponentTeamScore = gameState.teamScores?.[opponentTeam] || 0;

  // When I'm in the kitty discard / trump selection phase, hide other
  // players' info panels so they don't visually overlap the discard UI,
  // especially on mobile where side players are absolutely positioned.
  const isMyDiscardPhase =
    gameState.status === 'TRUMP_SELECTION' && gameState.bidWinner === gameState.seat;
  
  // Debug: Log the comparison whenever in TRUMP_SELECTION
  if (gameState.status === 'TRUMP_SELECTION') {
    console.log('[TrumpSelection] Checking if I should show DiscardUI:', {
      status: gameState.status,
      bidWinner: gameState.bidWinner,
      bidWinnerType: typeof gameState.bidWinner,
      mySeat: gameState.seat,
      mySeatType: typeof gameState.seat,
      isEqual: gameState.bidWinner === gameState.seat,
      isMyDiscardPhase,
    });
  }

  // Track status changes to detect new hands
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const currentStatus = gameState.status;
    
    // If we're transitioning TO BIDDING from a non-BIDDING status, it's a new hand
    if (currentStatus === 'BIDDING' && previousStatus !== 'BIDDING' && previousStatus !== undefined) {
      hasAnimatedForCurrentHandRef.current = false;
    }
    
    // Reset animation flag when hand completes or game resets
    if (currentStatus === 'FINISHED' || currentStatus === 'FULL' || currentStatus === 'PARTNER_SELECTION') {
      hasAnimatedForCurrentHandRef.current = false;
    }
    
    previousStatusRef.current = currentStatus;
  }, [gameState.status]);

  // WebSocket handlers
  const { sendMessage } = useWebSocket({
    gameState,
    onPlayerJoined: (player, players, status) => {
      console.log('Player joined:', player, 'All players:', players);
      setGameState(prev => ({
        ...prev,
        players: players,
        status: status || prev.status,
      }));
      // Update localStorage
      localStorage.setItem('rook_players', JSON.stringify(players));
    },
    onDeal: (cards) => {
      // Check if this is a reconnection:
      // 1. We already have cards AND
      // 2. We've already animated for this hand OR game is in TRUMP_SELECTION/PLAYING (past the initial deal)
      // 3. AND the card count hasn't changed significantly (indicating a new hand)
      const cardCountChanged = playerHand.length !== cards.length;
      const isReconnection = playerHand.length > 0 && 
        !cardCountChanged &&
        (hasAnimatedForCurrentHandRef.current || 
         gameState.status === 'TRUMP_SELECTION' || 
         gameState.status === 'PLAYING');
      
      setPlayerHand(cards);
      console.log(`Received ${cards.length} cards${isReconnection ? ' (reconnection, skipping animation)' : ''}`);
      
      // Only start dealing animation if this is a new hand, not a reconnection
      // Animate if: we're in BIDDING/PARTNER_SELECTION and haven't animated yet, OR card count changed (new hand)
      if (!isReconnection && (gameState.status === 'BIDDING' || gameState.status === 'PARTNER_SELECTION' || cardCountChanged)) {
        // Mark that we've animated for this hand
        hasAnimatedForCurrentHandRef.current = true;
        
        // Start dealing animation
        setIsDealing(true);
        setDealtCardCount(0);
        setIsFlipping(false);
        setDealAnimationComplete(false);
        
        // Deal cards one by one from deck (120ms between each card)
        const dealDelay = 120;
        let currentDealt = 0;
        
        const dealInterval = setInterval(() => {
          currentDealt++;
          setDealtCardCount(currentDealt);
          
          if (currentDealt >= cards.length) {
            clearInterval(dealInterval);
            // After all cards are dealt, wait for last card animation to complete (400ms)
            // then start flip animation
            setTimeout(() => {
              setIsFlipping(true);
              // Flip animation completes after all cards flip (13 cards * 100ms delay + 300ms flip duration)
              const flipDuration = cards.length * 100 + 300;
              setTimeout(() => {
                setIsDealing(false);
                setIsFlipping(false);
                setDealtCardCount(0);
                setDealAnimationComplete(true);
              }, flipDuration);
            }, 400);
          }
        }, dealDelay);
      } else {
        // Reconnection: just update the hand silently, mark animation as complete
        setDealAnimationComplete(true);
      }
    },
    onSeatsRearranged: (players, teams) => {
      const myNewSeat = players.find((p) => p.name === gameState.playerName)?.seat;
      if (myNewSeat !== undefined) {
        setGameState((prev) => ({
          ...prev,
          players,
          seat: myNewSeat,
          teams: teams || prev.teams,
        }));
        localStorage.setItem('rook_seat', myNewSeat.toString());
        localStorage.setItem('rook_players', JSON.stringify(players));
        if (teams) {
          localStorage.setItem('rook_teams', JSON.stringify(teams));
        }
        console.log(`Seats rearranged. My new seat: ${myNewSeat}`);
      }
    },
    onBiddingStart: (startingPlayer, minBid) => {
      // Clear all previous bid messages when bidding starts
      setBidMessages(new Map());
      setBiddingState({
        highBid: 0,
        currentBidder: startingPlayer,
        minBid,
      });
      setGameState((prev) => ({
        ...prev,
        status: 'BIDDING',
      }));
      // If deal animation is already complete, show bidding UI immediately
      // Otherwise, it will show when dealAnimationComplete becomes true
      console.log('Bidding started. Starting player:', startingPlayer);
    },
    onBidPlaced: (amount: number, seat: number, nextBidder?: number) => {
      setBiddingState((prev) => ({
        ...prev,
        highBid: amount,
        // Update currentBidder if nextBidder is provided (batched message)
        ...(nextBidder !== undefined && { currentBidder: nextBidder }),
      }));
      // Update or add bid message for this player (will replace existing bid)
      setBidMessages((prev) => {
        const newMap = new Map(prev);
        newMap.set(seat, `${amount}`);
        return newMap;
      });
      console.log(`Player ${seat} bid ${amount}${nextBidder !== undefined ? `, next bidder: ${nextBidder}` : ''}`);
    },
    onPlayerPassed: (seat: number, nextBidder?: number) => {
      // Update or add "I fold" message for this player (will replace existing bid)
      setBidMessages((prev) => {
        const newMap = new Map(prev);
        newMap.set(seat, 'I fold');
        return newMap;
      });
      // Update currentBidder if nextBidder is provided (batched message)
      if (nextBidder !== undefined) {
        setBiddingState((prev) => ({
          ...prev,
          currentBidder: nextBidder,
        }));
      }
      console.log(`Player ${seat} passed${nextBidder !== undefined ? `, next bidder: ${nextBidder}` : ''}`);
    },
    onNextBidder: (seat) => {
      setBiddingState((prev) => ({
        ...prev,
        currentBidder: seat,
      }));
      console.log(`Next bidder: seat ${seat}`);
    },
    onKitty: (kittyCards) => {
      // Track kitty card strings for display purposes
      const kittyStrings = new Set(kittyCards.map((c: CardType) => cardToString(c)));
      setKittyCardStrings(kittyStrings);
      
      setPlayerHand((prev) => {
        const currentCardCount = prev.length;
        if (currentCardCount >= 18) {
          console.log(`Already have ${currentCardCount} cards, ignoring duplicate kitty`);
          return prev;
        }
        const newHand = [...prev, ...kittyCards];
        console.log(`Received ${kittyCards.length} kitty cards, now have ${newHand.length} total`);
        return newHand;
      });
      setGameState((prev) => ({
        ...prev,
        status: 'TRUMP_SELECTION',
      }));
    },
    onBiddingWon: (winner, amount) => {
      console.log('[BiddingWon] Received:', { winner, amount, winnerType: typeof winner });
      console.log('[BiddingWon] My seat:', gameState.seat, 'type:', typeof gameState.seat);
      console.log('[BiddingWon] Am I the winner?', winner === gameState.seat, 'strict:', winner === gameState.seat);
      
      // Clear all bid messages when bidding ends
      setBidMessages(new Map());
      setBiddingState((prev) => ({
        ...prev,
        currentBidder: null,
      }));
      setGameState((prev) => {
        console.log('[BiddingWon] Setting state - prev.seat:', prev.seat, 'winner:', winner);
        console.log('[BiddingWon] Will show DiscardUI?', winner === prev.seat);
        return {
          ...prev,
          status: 'TRUMP_SELECTION',
          bidWinner: winner,
          winningBid: amount,
        };
      });
      console.log(`Player ${winner} won the bid with ${amount} points`);
    },
    onTrumpChosen: (suit: string, leader?: number) => {
      setGameState((prev) => ({
        ...prev,
        status: 'PLAYING',
        trump: suit,
        // Update currentPlayer if leader is provided (batched message)
        ...(leader !== undefined && { currentPlayer: leader }),
      }));
      console.log(`Trump suit chosen: ${suit}${leader !== undefined ? `, leader: ${leader}` : ''}`);
    },
    onPlayStart: (leader) => {
      setGameState((prev) => ({
        ...prev,
        status: 'PLAYING',
        currentPlayer: leader,
      }));
      console.log(`Play started. Leader: seat ${leader}`);
    },
    onCardPlayed: (seat: number, cardString: string, nextPlayer?: number) => {
      console.log(`Player ${seat} played card ${cardString}`);
      const playedCard = parseCard(cardString);
      
      // Clear pending status for this card if it was our card
      if (seat === gameState.seat) {
        pendingCardPlaysRef.current.delete(cardString);
      }
      
      // Show rook overlay if Rook card was played
      if (cardString === 'Rook') {
        console.log(`🦅 Rook card played by seat ${seat} - showing overlay for all players`);
        // Clear any existing timeout
        if (rookOverlayTimeoutRef.current) {
          clearTimeout(rookOverlayTimeoutRef.current);
        }
        setShowRookOverlay(true);
        rookOverlayTimeoutRef.current = setTimeout(() => {
          setShowRookOverlay(false);
          rookOverlayTimeoutRef.current = null;
        }, 2000);
      }
      
      setCurrentTrick((prev) => {
        const newTrick = [...prev, { seat, card: playedCard }];
        // If this is the first card of the trick, update ledSuit
        if (prev.length === 0) {
          const cardSuit = playedCard.color === 'Rook' ? gameState.trump : playedCard.color;
          setGameState((prevState) => ({
            ...prevState,
            ledSuit: cardSuit,
            // Update currentPlayer if nextPlayer is provided (batched message)
            ...(nextPlayer !== undefined && { currentPlayer: nextPlayer }),
          }));
        } else if (nextPlayer !== undefined) {
          // Update currentPlayer if nextPlayer is provided (batched message)
          setGameState((prev) => ({
            ...prev,
            currentPlayer: nextPlayer,
          }));
        }
        return newTrick;
      });
    },
    onNextPlayer: (seat) => {
      setGameState((prev) => ({
        ...prev,
        currentPlayer: seat,
      }));
      console.log(`Next player: seat ${seat}`);
    },
    onTrickWon: (winner, points) => {
      console.log(`Player ${winner} won the trick with ${points} points`);
      // Clear any pending card plays when trick ends
      pendingCardPlaysRef.current.clear();
      
      setTrickWonNotification({ winner, points });
      // Popup shows for 1 second
      setTimeout(() => {
        setTrickWonNotification(null);
      }, 2500);
      // Cards disappear 1 second after popup goes away (2 seconds total: 1s popup + 1s delay)
      setTimeout(() => {
        setCurrentTrick([]);
        // Clear ledSuit when trick is won
        setGameState((prev) => ({
          ...prev,
          ledSuit: undefined,
        }));
      }, 3500);
    },
    onHandComplete: (message) => {
      console.log('Hand complete:', message);
      if (message.handHistory) {
        setHandHistory(message.handHistory);
      }
      setGameState((prev) => ({
        ...prev,
        dealer: typeof message.dealer === 'number' ? message.dealer : prev.dealer,
        teamScores: {
          team0: message.team0Total,
          team1: message.team1Total,
        },
        handHistory: message.handHistory || prev.handHistory,
      }));
      // Show scores after each hand (not just at game over) so we can
      // quickly see results in testing mode.
      setShowScoresModal(true);
    },
    onGameOver: (message) => {
      console.log('Game over:', message);
      setGameState((prev) => ({
        ...prev,
        status: 'FINISHED',
      }));
      // Save the winner
      if (message.winner) {
        setGameWinner(message.winner);
      }
      // Show scores modal when game is over
      // Use handHistory from state if available, otherwise from message
      if (gameState.handHistory && gameState.handHistory.length > 0) {
        setHandHistory(gameState.handHistory);
      }
      setShowScoresModal(true);
    },
    onGameReset: (message) => {
      console.log('Game reset:', message);
      // Clear pending card plays
      pendingCardPlaysRef.current.clear();
      
      // Reset all local game state
      setPlayerHand([]);
      setCurrentTrick([]);
      setTrickWonNotification(null);
      setShowScoresModal(false);
      setHandHistory([]);
      setGameWinner(null);
      setShowRookOverlay(false);
      setIsDealing(false);
      setIsFlipping(false);
      setDealtCardCount(0);
      setDealAnimationComplete(false);
      if (rookOverlayTimeoutRef.current) {
        clearTimeout(rookOverlayTimeoutRef.current);
        rookOverlayTimeoutRef.current = null;
      }
      setBiddingState({
        highBid: null,
        currentBidder: null,
        minBid: 50,
      });
      // Update game state to show lobby
      setGameState((prev) => ({
        ...prev,
        status: message.status || 'FULL',
        teams: null,
        trump: undefined,
        currentPlayer: undefined,
        bidWinner: undefined,
        winningBid: undefined,
        ledSuit: undefined,
        teamScores: { team0: 0, team1: 0 },
        handHistory: [],
        dealer: undefined,
      }));
    },
    onError: (action, message) => {
      console.error(`${action} error:`, message);
      
      // If it's a card error, clear the pending status for all cards
      // (we don't know which specific card failed, so clear all to be safe)
      if (action === 'cardError') {
        console.log('Clearing all pending card plays due to card error');
        pendingCardPlaysRef.current.clear();
      }
      
      // Only show alert for non-card errors, or card errors that aren't "already played" type
      // (duplicate sends will be silently ignored)
      if (action !== 'cardError' || !message.includes('do not have that card')) {
        alert(message || 'An error occurred');
      }
    },
    onQuickChat: (seat, message) => {
      const timestamp = Date.now();
      setQuickChatMessages((prev) => [...prev, { seat, message, timestamp }]);
      
      // Auto-remove message after 2.5 seconds
      setTimeout(() => {
        setQuickChatMessages((prev) => prev.filter((msg) => msg.timestamp !== timestamp));
      }, 2500);
    },
    onResync: (message) => {
      console.log('[Resync] Received full game state:', message);
      
      // Update game state with server state
      setGameState(prev => ({
        ...prev,
        status: message.status || prev.status,
        players: message.players || prev.players,
        teams: message.teams || prev.teams,
        dealer: message.dealer !== undefined ? message.dealer : prev.dealer,
        trump: message.trump || prev.trump,
        currentPlayer: message.currentPlayer !== undefined ? message.currentPlayer : prev.currentPlayer,
        bidWinner: message.bidWinner !== undefined ? message.bidWinner : prev.bidWinner,
        winningBid: message.winningBid !== undefined ? message.winningBid : prev.winningBid,
        ledSuit: message.ledSuit || prev.ledSuit,
        teamScores: message.teamScores || prev.teamScores,
        handHistory: message.handHistory || prev.handHistory,
      }));
      
      // Update player's hand if cards were provided
      if (message.cards && Array.isArray(message.cards) && message.cards.length > 0) {
        const parsedCards = message.cards.map(parseCard);
        setPlayerHand(parsedCards);
        // Mark animation as complete since this is a resync (skip dealing animation)
        setDealAnimationComplete(true);
        hasAnimatedForCurrentHandRef.current = true;
        console.log(`[Resync] Updated hand with ${parsedCards.length} cards`);
      }
      
      // Update bidding state if in bidding phase
      if (message.status === 'BIDDING') {
        setBiddingState({
          highBid: message.highBid || 0,
          currentBidder: message.currentBidder !== undefined ? message.currentBidder : null,
          minBid: 50,
        });
      }
      
      // Restore current trick if in playing phase
      if (message.status === 'PLAYING' && message.currentTrick && Array.isArray(message.currentTrick)) {
        const parsedTrick = message.currentTrick.map((play: { seat: number; card: string }) => ({
          seat: play.seat,
          card: parseCard(play.card),
        }));
        setCurrentTrick(parsedTrick);
        console.log(`[Resync] Restored current trick with ${parsedTrick.length} cards`);
      }
      
      // Handle kitty cards for bid winner in TRUMP_SELECTION
      if (message.kitty && Array.isArray(message.kitty) && message.kitty.length > 0) {
        const kittyCards = message.kitty.map(parseCard);
        setPlayerHand(prev => {
          // Only add kitty if we don't already have 18 cards
          if (prev.length < 18) {
            const kittyStrings = new Set<string>(kittyCards.map((c: CardType) => cardToString(c)));
            setKittyCardStrings(kittyStrings);
            return [...prev, ...kittyCards];
          }
          return prev;
        });
        console.log(`[Resync] Added ${kittyCards.length} kitty cards`);
      }
      
      // Update localStorage with new player/team data
      if (message.players) {
        localStorage.setItem('rook_players', JSON.stringify(message.players));
      }
      if (message.teams) {
        localStorage.setItem('rook_teams', JSON.stringify(message.teams));
      }
    },
  });

  // Show waiting lobby if game is not yet in playing state
  if (gameState.status === 'LOBBY' || gameState.status === 'FULL' || gameState.status === 'PARTNER_SELECTION') {
    return (
      <WaitingLobby
        gameState={gameState}
        onRefresh={refreshGameState}
        isRefreshing={isRefreshing}
        onPartnerSelected={refreshGameState}
      />
    );
  }

  // Show the game table when playing
  return (
    <div className="game-container">
      {/* Compact header */}
      <header className="game-header">
        <div className="game-status">
          <div className="game-stats-row">
            <span className="stat">
              You: <strong>{myTeamScore}</strong>
            </span>
            <span className="stat">
              Opponents: <strong>{opponentTeamScore}</strong>
            </span>
            <span className="stat">
              Bid: <strong>{gameState.winningBid || '--'}</strong>
            </span>
            <span className="stat">
              Kitty: <strong>{gameState.bidWinner !== undefined && gameState.players ? gameState.players.find((p) => p.seat === gameState.bidWinner)?.name || '--' : '--'}</strong>
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="quick-chat-btn"
            onClick={() => setShowQuickChat(true)}
            aria-label="Quick Chat"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <main className="game-table">
        {/* Top player (across from user) - relative position 2 */}
        <section className="table-section table-top">
          {!isMyDiscardPhase &&
            (() => {
              const topSeat = getAbsoluteSeat(2, gameState.seat);
              const topPlayer = gameState.players.find((p) => p.seat === topSeat);
              const topBidMessage = gameState.status === 'BIDDING' ? bidMessages.get(topSeat) : undefined;
              const topMessage = gameState.status !== 'BIDDING' ? quickChatMessages.find((msg) => msg.seat === topSeat) : undefined;
              return (
                <div className="player-info-wrapper">
                  {topBidMessage && (
                    <QuickChatMessage message={topBidMessage} position="bottom" />
                  )}
                  {topMessage && !topBidMessage && (
                    <QuickChatMessage message={topMessage.message} position="bottom" />
                  )}
                  <PlayerInfo
                    name={topPlayer?.name || `Player ${topSeat + 1}`}
                    position="top"
                    isPartner={isMyPartner(topSeat, gameState.seat, gameState.teams)}
                    isCurrentTurn={
                      (gameState.status === 'BIDDING' && biddingState.currentBidder === topSeat) ||
                      (gameState.status === 'PLAYING' && gameState.currentPlayer === topSeat)
                    }
                  />
                </div>
              );
            })()}
        </section>

        {/* Middle section: side players + play area */}
        <section className="table-section table-middle">
          {/* Left player - relative position 1 */}
          {!isMyDiscardPhase &&
            (() => {
              const leftSeat = getAbsoluteSeat(1, gameState.seat);
              const leftPlayer = gameState.players.find((p) => p.seat === leftSeat);
              const leftBidMessage = gameState.status === 'BIDDING' ? bidMessages.get(leftSeat) : undefined;
              const leftMessage = gameState.status !== 'BIDDING' ? quickChatMessages.find((msg) => msg.seat === leftSeat) : undefined;
              return (
                <div className="player-info-wrapper player-info-wrapper-left">
                  {leftBidMessage && (
                    <QuickChatMessage message={leftBidMessage} position="bottom" />
                  )}
                  {leftMessage && !leftBidMessage && (
                    <QuickChatMessage message={leftMessage.message} position="bottom" />
                  )}
                  <PlayerInfo
                    name={leftPlayer?.name || `Player ${leftSeat + 1}`}
                    position="left"
                    isPartner={isMyPartner(leftSeat, gameState.seat, gameState.teams)}
                    isCurrentTurn={
                      (gameState.status === 'BIDDING' && biddingState.currentBidder === leftSeat) ||
                      (gameState.status === 'PLAYING' && gameState.currentPlayer === leftSeat)
                    }
                  />
                </div>
              );
            })()}

          <div className="center-area">
            {/* Deck visual - shown during dealing */}
            {isDealing && (
              <Deck 
                cardCount={sortedHand.length - dealtCardCount} 
                isVisible={true}
              />
            )}
            
            {/* Bidding UI - shown when game is in BIDDING status AND deal animation is complete */}
            {gameState.status === 'BIDDING' && dealAnimationComplete ? (
              <BiddingUI
                highBid={biddingState.highBid}
                currentBidder={biddingState.currentBidder}
                mySeat={gameState.seat}
                minBid={biddingState.minBid}
                players={gameState.players}
                onBid={(amount) => {
                  const success = sendMessage({
                    action: 'bid',
                    amount,
                    seat: gameState.seat,
                  });
                  if (!success) {
                    console.error('Failed to send bid. WebSocket may not be connected.');
                    alert('Failed to send bid. Please check your connection.');
                  } else {
                    console.log('Sent bid:', amount);
                  }
                }}
                onPass={() => {
                  const success = sendMessage({
                    action: 'pass',
                    seat: gameState.seat,
                  });
                  if (!success) {
                    console.error('Failed to send pass. WebSocket may not be connected.');
                    alert('Failed to send pass. Please check your connection.');
                  } else {
                    console.log('Sent pass');
                  }
                }}
              />
            ) : gameState.status === 'TRUMP_SELECTION' && gameState.bidWinner === gameState.seat ? (
              <DiscardUI
                hand={sortedHand}
                kittyCardStrings={kittyCardStrings}
                onConfirm={(discardCards, trump) => {
                  sendMessage({
                    action: 'discardAndTrump',
                    discard: discardCards,
                    trump,
                    seat: gameState.seat,
                  });
                  console.log('Sent discard and trump:', discardCards, trump);

                  // Immediately remove discarded cards from UI
                  setPlayerHand((prev) =>
                    prev.filter((card) => {
                      const cardString = cardToString(card);
                      return !discardCards.includes(cardString);
                    })
                  );
                }}
              />
            ) : gameState.status === 'TRUMP_SELECTION' && gameState.bidWinner !== gameState.seat ? (
              <div className="pending-trump-popup">
                <div className="pending-trump-content">
                  <h3>Pending trump color...</h3>
                  <p>
                    Waiting for{' '}
                    {gameState.players?.find((p) => p.seat === gameState.bidWinner)?.name || 'bid winner'} to choose
                    trump suit.
                  </p>
                </div>
              </div>
            ) : gameState.status === 'PLAYING' ? (
              <>
                <TrickArea 
                  currentTrick={currentTrick} 
                  mySeat={gameState.seat} 
                  trump={gameState.trump}
                  canDrop={gameState.currentPlayer === gameState.seat}
                  onCardDrop={(card) => {
                    // Check if it's my turn and card is playable
                    if (gameState.currentPlayer !== gameState.seat) return;
                    if (!isCardPlayable(card, sortedHand, gameState.ledSuit, gameState.trump)) return;
                    
                    const cardString = cardToString(card);
                    
                    // Prevent duplicate sends - check if this card is already being played
                    if (pendingCardPlaysRef.current.has(cardString)) {
                      console.warn('Card already being played, ignoring duplicate:', cardString);
                      return;
                    }
                    
                    // Mark card as pending
                    pendingCardPlaysRef.current.add(cardString);
                    
                    sendMessage({
                      action: 'playCard',
                      card: cardString,
                    });
                    console.log('Dropped and played card:', cardString);

                    // Immediately remove card from hand UI
                    setPlayerHand((prev) =>
                      prev.filter((c) => !(c.color === card.color && c.rank === card.rank))
                    );
                  }}
                />
                {trickWonNotification && (
                  <TrickWonNotificationComponent notification={trickWonNotification} players={gameState.players} />
                )}
              </>
            ) : (
              <>
                <TrickArea currentTrick={currentTrick} mySeat={gameState.seat} trump={gameState.trump} />
                {gameState.status !== 'BIDDING' && gameState.status !== 'LOBBY' && gameState.status !== 'FULL' && gameState.status !== 'PARTNER_SELECTION' && (
                  <KittyDisplay cardCount={5} />
                )}
                {trickWonNotification && (
                  <TrickWonNotificationComponent notification={trickWonNotification} players={gameState.players} />
                )}
              </>
            )}
          </div>

          {/* Right player - relative position 3 */}
          {!isMyDiscardPhase &&
            (() => {
              const rightSeat = getAbsoluteSeat(3, gameState.seat);
              const rightPlayer = gameState.players.find((p) => p.seat === rightSeat);
              const rightBidMessage = gameState.status === 'BIDDING' ? bidMessages.get(rightSeat) : undefined;
              const rightMessage = gameState.status !== 'BIDDING' ? quickChatMessages.find((msg) => msg.seat === rightSeat) : undefined;
              return (
                <div className="player-info-wrapper player-info-wrapper-right">
                  {rightBidMessage && (
                    <QuickChatMessage message={rightBidMessage} position="bottom" />
                  )}
                  {rightMessage && !rightBidMessage && (
                    <QuickChatMessage message={rightMessage.message} position="bottom" />
                  )}
                  <PlayerInfo
                    name={rightPlayer?.name || `Player ${rightSeat + 1}`}
                    position="right"
                    isPartner={isMyPartner(rightSeat, gameState.seat, gameState.teams)}
                    isCurrentTurn={
                      (gameState.status === 'BIDDING' && biddingState.currentBidder === rightSeat) ||
                      (gameState.status === 'PLAYING' && gameState.currentPlayer === rightSeat)
                    }
                  />
                </div>
              );
            })()}
        </section>

        {/* Bottom: local player's hand */}
        <section className="table-section table-bottom">
          <div
            className={`local-player ${
              (gameState.status === 'BIDDING' && biddingState.currentBidder === gameState.seat) ||
              (gameState.status === 'PLAYING' && gameState.currentPlayer === gameState.seat)
                ? 'current-turn'
                : ''
            }`}
          >
            <div className="local-player-header">
              <div className="local-player-info-wrapper">
                {(() => {
                  const myBidMessage = gameState.status === 'BIDDING' ? bidMessages.get(gameState.seat) : undefined;
                  const myMessage = gameState.status !== 'BIDDING' ? quickChatMessages.find((msg) => msg.seat === gameState.seat) : undefined;
                  return (
                    <>
                      {myBidMessage && (
                        <QuickChatMessage message={myBidMessage} position="top" />
                      )}
                      {myMessage && !myBidMessage && (
                        <QuickChatMessage message={myMessage.message} position="top" />
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="hand-container">
              <CardFan
                cards={sortedHand}
                onCardPlay={(card) => {
                  const cardString = cardToString(card);
                  
                  // Prevent duplicate sends - check if this card is already being played
                  if (pendingCardPlaysRef.current.has(cardString)) {
                    console.warn('Card already being played, ignoring duplicate:', cardString);
                    return;
                  }
                  
                  // Mark card as pending
                  pendingCardPlaysRef.current.add(cardString);
                  
                  sendMessage({
                    action: 'playCard',
                    card: cardString,
                  });
                  console.log('Sent playCard:', cardString);

                  // Immediately remove card from hand UI
                  setPlayerHand((prev) =>
                    prev.filter((c) => !(c.color === card.color && c.rank === card.rank))
                  );
                }}
                isCardPlayable={(card) => isCardPlayable(card, sortedHand, gameState.ledSuit, gameState.trump)}
                isMyTurn={gameState.status === 'PLAYING' && gameState.currentPlayer === gameState.seat}
                isDealing={isDealing || isFlipping}
                dealtCardCount={dealtCardCount}
              />
            </div>
          </div>
        </section>
      </main>
      <RookOverlay show={showRookOverlay} />
      {showScoresModal && gameState.teams && handHistory.length > 0 && (
        <ScoresModal
          handHistory={handHistory}
          teams={gameState.teams}
          mySeat={gameState.seat}
          isDealer={gameState.dealer === gameState.seat}
          isGameOver={gameWinner !== null}
          isHost={gameState.seat === 0 || gameState.isHost === true}
          winner={gameWinner}
          onDealNextHand={async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/startNextHand`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  gameId: gameState.gameId,
                  dealerSeat: gameState.seat,
                }),
              });
              const data = await response.json();
              if (!response.ok || !data.success) {
                console.error('Failed to start next hand:', data);
                alert(data.message || 'Failed to start next hand');
                return;
              }
              // Close scores modal; new deal + biddingStart will come via WebSocket
              setShowScoresModal(false);
            } catch (error) {
              console.error('Error starting next hand:', error);
              alert('Error starting next hand. Please try again.');
            }
          }}
          onBackToLobby={async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/resetGame`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  gameId: gameState.gameId,
                }),
              });
              const data = await response.json();
              if (!response.ok || !data.success) {
                console.error('Failed to reset game:', data);
                alert(data.message || 'Failed to reset game');
                return;
              }
              // The gameReset WebSocket message will handle resetting local state
              console.log('Game reset successfully');
            } catch (error) {
              console.error('Error resetting game:', error);
              alert('Error resetting game. Please try again.');
            }
          }}
          onClose={() => setShowScoresModal(false)}
        />
      )}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        cardSortMethod={cardSortMethod}
        onCardSortMethodChange={handleCardSortMethodChange}
      />
      <QuickChatModal
        isOpen={showQuickChat}
        onClose={() => setShowQuickChat(false)}
        onSelectMessage={(message) => {
          const success = sendMessage({
            action: 'quickChat',
            message,
            seat: gameState.seat,
          });
          if (!success) {
            console.error('Failed to send quick chat message. WebSocket may not be connected.');
            alert('Failed to send message. Please check your connection.');
          } else {
            console.log('Sent quick chat:', message);
          }
        }}
      />
    </div>
  );
};

export default GamePage;
