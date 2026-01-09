import React, { useState, useEffect } from 'react';
import { Card as CardType, TrickWonNotification } from '../types/game';
import { useGameState, useWebSocket } from '../hooks';
import {
  Card,
  PlayerInfo,
  TrickArea,
  KittyDisplay,
  DiscardUI,
  WaitingLobby,
  BiddingUI,
  TrickWonNotification as TrickWonNotificationComponent,
} from '../components';
import { ScoresModal } from '../components/ScoresModal';
import { sortCards, isCardPlayable, cardToString, parseCard } from '../utils/cardUtils';
import { getAbsoluteSeat, isMyPartner } from '../utils/seatUtils';
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

  const sortedHand = sortCards(playerHand);

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

  // WebSocket handlers
  const { sendMessage, connected: wsConnected } = useWebSocket({
    gameState,
    onDeal: (cards) => {
      setPlayerHand(cards);
      console.log(`Received ${cards.length} cards`);
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
      setBiddingState({
        highBid: 0,
        currentBidder: startingPlayer,
        minBid,
      });
      setGameState((prev) => ({
        ...prev,
        status: 'BIDDING',
      }));
      console.log('Bidding started. Starting player:', startingPlayer);
    },
    onBidPlaced: (amount, seat) => {
      setBiddingState((prev) => ({
        ...prev,
        highBid: amount,
      }));
      console.log(`Player ${seat} bid ${amount}`);
    },
    onPlayerPassed: (seat) => {
      console.log(`Player ${seat} passed`);
    },
    onNextBidder: (seat) => {
      setBiddingState((prev) => ({
        ...prev,
        currentBidder: seat,
      }));
      console.log(`Next bidder: seat ${seat}`);
    },
    onKitty: (kittyCards) => {
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
      setBiddingState((prev) => ({
        ...prev,
        currentBidder: null,
      }));
      setGameState((prev) => ({
        ...prev,
        status: 'TRUMP_SELECTION',
        bidWinner: winner,
        winningBid: amount,
      }));
      console.log(`Player ${winner} won the bid with ${amount} points`);
    },
    onTrumpChosen: (suit) => {
      setGameState((prev) => ({
        ...prev,
        status: 'PLAYING',
        trump: suit,
      }));
      console.log(`Trump suit chosen: ${suit}`);
    },
    onPlayStart: (leader) => {
      setGameState((prev) => ({
        ...prev,
        status: 'PLAYING',
        currentPlayer: leader,
      }));
      console.log(`Play started. Leader: seat ${leader}`);
    },
    onCardPlayed: (seat, cardString) => {
      console.log(`Player ${seat} played card ${cardString}`);
      const playedCard = parseCard(cardString);
      setCurrentTrick((prev) => {
        const newTrick = [...prev, { seat, card: playedCard }];
        // If this is the first card of the trick, update ledSuit
        if (prev.length === 0) {
          const cardSuit = playedCard.color === 'Rook' ? gameState.trump : playedCard.color;
          setGameState((prevState) => ({
            ...prevState,
            ledSuit: cardSuit,
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
      setTrickWonNotification({ winner, points });
      setTimeout(() => {
        setTrickWonNotification(null);
      }, 3000);
      setTimeout(() => {
        setCurrentTrick([]);
        // Clear ledSuit when trick is won
        setGameState((prev) => ({
          ...prev,
          ledSuit: undefined,
        }));
      }, 2000);
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
      // Show scores modal when game is over
      // Use handHistory from state if available, otherwise from message
      if (gameState.handHistory && gameState.handHistory.length > 0) {
        setHandHistory(gameState.handHistory);
      }
      setShowScoresModal(true);
    },
    onError: (action, message) => {
      console.error(`${action} error:`, message);
      alert(message || 'An error occurred');
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
              Your Team: <strong>{myTeamScore}</strong>
            </span>
            <span className="stat">
              Opponents: <strong>{opponentTeamScore}</strong>
            </span>
            <span className="stat">
              Bid: <strong>{gameState.winningBid || '--'}</strong>
            </span>
            <span className="stat">
              Trump: <strong>{gameState.trump || '--'}</strong>
            </span>
            <span className="stat">
              Kitty: <strong>{gameState.bidWinner !== undefined && gameState.players ? gameState.players.find((p) => p.seat === gameState.bidWinner)?.name || 'Unknown' : '--'}</strong>
            </span>
          </div>
        </div>
      </header>

      <main className="game-table">
        {/* Top player (across from user) - relative position 2 */}
        <section className="table-section table-top">
          {!isMyDiscardPhase &&
            (() => {
              const topSeat = getAbsoluteSeat(2, gameState.seat);
              const topPlayer = gameState.players.find((p) => p.seat === topSeat);
              return (
                <PlayerInfo
                  name={topPlayer?.name || `Player ${topSeat + 1}`}
                  position="top"
                  isPartner={isMyPartner(topSeat, gameState.seat, gameState.teams)}
                  isCurrentTurn={
                    (gameState.status === 'BIDDING' && biddingState.currentBidder === topSeat) ||
                    (gameState.status === 'PLAYING' && gameState.currentPlayer === topSeat)
                  }
                />
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
              return (
                <PlayerInfo
                  name={leftPlayer?.name || `Player ${leftSeat + 1}`}
                  position="left"
                  isPartner={isMyPartner(leftSeat, gameState.seat, gameState.teams)}
                  isCurrentTurn={
                    (gameState.status === 'BIDDING' && biddingState.currentBidder === leftSeat) ||
                    (gameState.status === 'PLAYING' && gameState.currentPlayer === leftSeat)
                  }
                />
              );
            })()}

          <div className="center-area">
            {/* Bidding UI - shown when game is in BIDDING status */}
            {gameState.status === 'BIDDING' ? (
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
                <TrickArea currentTrick={currentTrick} mySeat={gameState.seat} />
                {trickWonNotification && (
                  <TrickWonNotificationComponent notification={trickWonNotification} players={gameState.players} />
                )}
              </>
            ) : (
              <>
                <TrickArea currentTrick={currentTrick} mySeat={gameState.seat} />
                <KittyDisplay cardCount={5} />
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
              return (
                <PlayerInfo
                  name={rightPlayer?.name || `Player ${rightSeat + 1}`}
                  position="right"
                  isPartner={isMyPartner(rightSeat, gameState.seat, gameState.teams)}
                  isCurrentTurn={
                    (gameState.status === 'BIDDING' && biddingState.currentBidder === rightSeat) ||
                    (gameState.status === 'PLAYING' && gameState.currentPlayer === rightSeat)
                  }
                />
              );
            })()}
        </section>

        {/* Bottom: local player's hand */}
        <section className="table-section table-bottom">
          <div className="local-player">
            <div className="local-player-header">
              <div
                className={`local-player-info ${
                  (gameState.status === 'BIDDING' && biddingState.currentBidder === gameState.seat) ||
                  (gameState.status === 'PLAYING' && gameState.currentPlayer === gameState.seat)
                    ? 'current-turn'
                    : ''
                }`}
              >
                <div className="local-avatar">You</div>
                <span className="local-name">{gameState.playerName}</span>
                <span className="card-count-badge">{sortedHand.length} cards</span>
              </div>
            </div>
            <div className="hand-container">
              <div className="hand-scroll">
                {sortedHand.length > 0 ? (
                  sortedHand.map((card, index) => {
                    const isPlayable = isCardPlayable(card, sortedHand, gameState.ledSuit, gameState.trump);
                    const isTurn = gameState.status === 'PLAYING' && gameState.currentPlayer === gameState.seat;
                    return (
                      <Card
                        key={`${card.color}-${card.rank}-${index}`}
                        card={card}
                        onDoubleClick={() => {
                          const cardString = cardToString(card);
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
                        disabled={!isTurn || !isPlayable}
                      />
                    );
                  })
                ) : (
                  <div className="hand-empty">
                    <p>Waiting for cards to be dealt...</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
      {showScoresModal && gameState.teams && handHistory.length > 0 && (
        <ScoresModal
          handHistory={handHistory}
          teams={gameState.teams}
          mySeat={gameState.seat}
          isDealer={gameState.dealer === gameState.seat}
          isGameOver={
            (() => {
              const last = handHistory[handHistory.length - 1];
              if (!last) return false;
              return last.team0Total >= 500 || last.team1Total >= 500;
            })()
          }
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
          onClose={() => setShowScoresModal(false)}
        />
      )}
    </div>
  );
};

export default GamePage;
