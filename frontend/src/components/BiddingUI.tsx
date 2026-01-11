import React, { useState, useEffect, useCallback } from 'react';
import { Player } from '../types/game';
import './BiddingUI.css';

interface BiddingUIProps {
  highBid: number | null;
  currentBidder: number | null;
  mySeat: number;
  minBid: number;
  players: Player[];
  onBid?: (amount: number) => void;
  onPass?: () => void;
}

export const BiddingUI: React.FC<BiddingUIProps> = ({
  highBid,
  currentBidder,
  mySeat,
  minBid,
  players,
  onBid,
  onPass,
}) => {
  const getNextValidBid = useCallback(() => {
    if (!highBid || highBid === 0) return minBid;
    return highBid + 5;
  }, [highBid, minBid]);

  const [bidAmount, setBidAmount] = useState(() => {
    if (!highBid || highBid === 0) return minBid;
    return highBid + 5;
  });
  const isMyTurn = currentBidder === mySeat;

  // Update bid amount when current bid changes
  useEffect(() => {
    const nextBid = getNextValidBid();
    setBidAmount(nextBid);
  }, [getNextValidBid]);

  const handleBid = () => {
    const nextBid = getNextValidBid();
    const validBid = bidAmount >= nextBid && bidAmount <= 180 && bidAmount % 5 === 0;

    if (onBid && validBid) {
      onBid(bidAmount);
    }
  };

  const handlePass = () => {
    if (onPass) {
      onPass();
    }
  };

  const handleIncrement = (amount: number) => {
    const nextBid = getNextValidBid();
    const newBid = Math.min(bidAmount + amount, 180);
    // Round up to nearest multiple of 5
    const roundedBid = Math.ceil(newBid / 5) * 5;
    setBidAmount(Math.max(roundedBid, nextBid));
  };

  const handleDecrement = (amount: number) => {
    const nextBid = getNextValidBid();
    const newBid = Math.max(bidAmount - amount, nextBid);
    // Round down to nearest multiple of 5
    const roundedBid = Math.floor(newBid / 5) * 5;
    setBidAmount(Math.max(roundedBid, nextBid));
  };

  const handleBidInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value)) {
      // Round to nearest multiple of 5
      const rounded = Math.round(value / 5) * 5;
      const nextBid = getNextValidBid();
      const clamped = Math.min(Math.max(rounded, nextBid), 180);
      setBidAmount(clamped);
    } else {
      setBidAmount(getNextValidBid());
    }
  };

  const nextBid = getNextValidBid();
  const isValidBid = bidAmount >= nextBid && bidAmount <= 180 && bidAmount % 5 === 0;

  return (
    <div className="bidding-panel">
      <div className="bidding-header">
        <div className="bidding-info">
          <span>Current Bid: <strong>{highBid || minBid}</strong></span>
        </div>
      </div>

      {isMyTurn && (
        <div className="bidding-controls">
          <div className="bid-input-group">
            <input
              type="number"
              min={nextBid}
              max={180}
              step="5"
              value={bidAmount}
              onChange={handleBidInputChange}
              className={!isValidBid ? 'invalid' : ''}
            />
            <div className="bid-adjust-buttons">
              <button
                type="button"
                className="adjust-btn"
                onClick={() => handleDecrement(5)}
                disabled={bidAmount <= nextBid}
              >
                -5
              </button>
              <button
                type="button"
                className="adjust-btn"
                onClick={() => handleIncrement(5)}
                disabled={bidAmount >= 180}
              >
                +5
              </button>
            </div>
          </div>
          <div className="bid-buttons">
            <button
              type="button"
              className="bid-btn"
              onClick={handleBid}
              disabled={!isValidBid}
            >
              Bid
            </button>
            <button
              type="button"
              className="pass-btn"
              onClick={handlePass}
            >
              Fold
            </button>
          </div>
        </div>
      )}

      {!isMyTurn && (
        <div className="bidding-waiting">
          {typeof currentBidder === 'number' && (() => {
            const bidderPlayer = players.find(p => p.seat === currentBidder);
            return `Waiting for ${bidderPlayer?.name || `Player ${currentBidder + 1}`} to bid...`;
          })()}
        </div>
      )}
    </div>
  );
};
