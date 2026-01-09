import React from 'react';
import { HandScore } from '../types/game';
import './ScoresModal.css';

interface ScoresModalProps {
  handHistory: HandScore[];
  teams: { team0: number[]; team1: number[] } | null;
  mySeat: number;
  onClose: () => void;
  isDealer: boolean;
  isGameOver: boolean;
  isHost: boolean;
  onDealNextHand: () => void;
  onBackToLobby: () => void;
  winner?: 'team0' | 'team1' | null;
}

export const ScoresModal: React.FC<ScoresModalProps> = ({
  handHistory,
  teams,
  mySeat,
  onClose,
  isDealer,
  isGameOver,
  isHost,
  onDealNextHand,
  onBackToLobby,
  winner,
}) => {
  if (!teams || handHistory.length === 0) {
    return null;
  }

  // Determine which team is "You + Partner"
  const myTeam = teams.team0.includes(mySeat) ? 'team0' : 'team1';
  const opponentTeam = myTeam === 'team0' ? 'team1' : 'team0';

  // Get final totals from last hand
  const finalTotals = handHistory[handHistory.length - 1];
  const myTeamTotal = finalTotals[`${myTeam}Total` as keyof HandScore] as number;
  const opponentTeamTotal = finalTotals[`${opponentTeam}Total` as keyof HandScore] as number;

  // Check if my team won
  const didWeWin = winner === myTeam;

  return (
    <div className="scores-modal-overlay" onClick={isGameOver ? undefined : onClose}>
      <div className="scores-modal-content" onClick={(e) => e.stopPropagation()}>
        {isGameOver && winner && (
          <div className={`game-over-banner ${didWeWin ? 'victory' : 'defeat'}`}>
            <div className="game-over-icon">{didWeWin ? '🏆' : '😔'}</div>
            <div className="game-over-text">
              {didWeWin ? 'Victory!' : 'Defeat'}
            </div>
            <div className="game-over-subtext">
              {didWeWin ? 'Your team wins the game!' : 'Better luck next time!'}
            </div>
          </div>
        )}
        <div className="scores-modal-header">
          <h2>{isGameOver ? 'FINAL SCORES' : 'SCORES'}</h2>
          {!isGameOver && (
            <button className="scores-modal-close" onClick={onClose}>×</button>
          )}
        </div>
        <div className="scores-modal-body">
          <div className="scores-table">
            <div className="scores-table-header">
              <div className="scores-col-hand">Hand</div>
              <div className="scores-col-team">You + Partner</div>
              <div className="scores-col-team">Opponents</div>
            </div>
            <div className="scores-table-body">
              {handHistory.map((hand, index) => {
                const myHandScore = hand[`${myTeam}HandScore` as keyof HandScore] as number;
                const opponentHandScore = hand[`${opponentTeam}HandScore` as keyof HandScore] as number;
                const myPoints = hand[`${myTeam}Points` as keyof HandScore] as number;
                const opponentPoints = hand[`${opponentTeam}Points` as keyof HandScore] as number;
                const bidTeam = hand.bidTeam;
                const madeBid = hand.madeBid;
                const isMyBid = bidTeam === myTeam;

                return (
                  <div key={index} className="scores-table-row">
                    <div className="scores-col-hand">
                      <div className="hand-number">{hand.round}</div>
                      <div className="hand-bid-info">
                        Bid: {hand.bid} {isMyBid ? (madeBid ? '✓' : '✗') : ''}
                      </div>
                    </div>
                    <div className="scores-col-team">
                      <div className={`hand-score-value ${myHandScore >= 0 ? 'positive' : 'negative'}`}>
                        {myHandScore >= 0 ? '+' : ''}{myHandScore}
                      </div>
                      <div className="hand-points-detail">({myPoints} pts)</div>
                      {hand.shootTheMoon && (myPoints === 0 || myPoints === 120) && (
                        <div className="shoot-moon-badge">🌙 Shoot the Moon!</div>
                      )}
                    </div>
                    <div className="scores-col-team">
                      <div className={`hand-score-value ${opponentHandScore >= 0 ? 'positive' : 'negative'}`}>
                        {opponentHandScore >= 0 ? '+' : ''}{opponentHandScore}
                      </div>
                      <div className="hand-points-detail">({opponentPoints} pts)</div>
                      {hand.shootTheMoon && (opponentPoints === 0 || opponentPoints === 120) && (
                        <div className="shoot-moon-badge">🌙 Shoot the Moon!</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="scores-table-footer">
              <div className="scores-col-hand">
                <strong>TOTAL</strong>
              </div>
              <div className="scores-col-team">
                <strong className="total-score">{myTeamTotal}</strong>
              </div>
              <div className="scores-col-team">
                <strong className="total-score">{opponentTeamTotal}</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="scores-modal-footer">
          {isGameOver ? (
            isHost ? (
              <button className="scores-modal-lobby-btn" onClick={onBackToLobby}>
                Back to Lobby
              </button>
            ) : (
              <div className="scores-modal-waiting">
                Waiting for host to return to lobby...
              </div>
            )
          ) : isDealer ? (
            <button className="scores-modal-deal-btn" onClick={onDealNextHand}>
              Deal Next Hand
            </button>
          ) : (
            <div className="scores-modal-waiting">
              Waiting for dealer to deal the next hand...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
