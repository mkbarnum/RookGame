import React from 'react';
import { Link } from 'react-router-dom';
import './GamePage.css';

// Card type definition
interface Card {
  color: 'Green' | 'Red' | 'Yellow' | 'Black' | 'Rook';
  rank: number | null; // null for Rook card
}

// Dummy data for user's hand
const userHand: Card[] = [
  { color: 'Green', rank: 1 },
  { color: 'Green', rank: 14 },
  { color: 'Green', rank: 10 },
  { color: 'Green', rank: 5 },
  { color: 'Red', rank: 1 },
  { color: 'Red', rank: 12 },
  { color: 'Red', rank: 7 },
  { color: 'Yellow', rank: 14 },
  { color: 'Yellow', rank: 11 },
  { color: 'Yellow', rank: 6 },
  { color: 'Black', rank: 13 },
  { color: 'Black', rank: 9 },
  { color: 'Rook', rank: null },
];

// Sort cards: group by color, within each color sort by rank (1 is highest)
const sortCards = (cards: Card[]): Card[] => {
  const colorOrder: Record<string, number> = {
    Green: 0,
    Red: 1,
    Yellow: 2,
    Black: 3,
    Rook: 4,
  };

  const getRankValue = (rank: number | null): number => {
    if (rank === null) return -1;
    if (rank === 1) return 15;
    return rank;
  };

  return [...cards].sort((a, b) => {
    const colorDiff = colorOrder[a.color] - colorOrder[b.color];
    if (colorDiff !== 0) return colorDiff;
    return getRankValue(b.rank) - getRankValue(a.rank);
  });
};

// Get color symbol for display
const getColorSymbol = (color: string): string => {
  switch (color) {
    case 'Green': return '●';
    case 'Red': return '●';
    case 'Yellow': return '●';
    case 'Black': return '●';
    default: return '♜';
  }
};

// Component for rendering a single card
const CardComponent: React.FC<{ card: Card; onClick?: () => void }> = ({ card, onClick }) => {
  const colorClass = card.color.toLowerCase();
  const isRook = card.color === 'Rook';

  return (
    <button className={`card ${colorClass}`} onClick={onClick} type="button">
      <span className="card-top">
        {isRook ? '♜' : card.rank}
      </span>
      <span className="card-symbol">
        {isRook ? 'ROOK' : getColorSymbol(card.color)}
      </span>
      <span className="card-bottom">
        {isRook ? '♜' : card.rank}
      </span>
    </button>
  );
};

// Component for a face-down card (simplified)
const CardBack: React.FC = () => (
  <div className="card card-back">
    <span className="back-pattern">♜</span>
  </div>
);

// Player info component
interface PlayerInfoProps {
  name: string;
  cardCount: number;
  position: 'top' | 'left' | 'right';
  isPartner?: boolean;
  isCurrentTurn?: boolean;
}

const PlayerInfo: React.FC<PlayerInfoProps> = ({ 
  name, 
  cardCount, 
  position, 
  isPartner,
  isCurrentTurn 
}) => (
  <div className={`player-info player-${position} ${isPartner ? 'partner' : ''} ${isCurrentTurn ? 'current-turn' : ''}`}>
    <div className="player-avatar">
      {name[0].toUpperCase()}
    </div>
    <div className="player-details">
      <span className="player-name">{name}</span>
      {isPartner && <span className="partner-badge">Partner</span>}
    </div>
    <div className="player-card-count">
      <CardBack />
      <span className="count">{cardCount}</span>
    </div>
  </div>
);

// Trick area with played cards
const TrickArea: React.FC = () => (
  <div className="trick-area">
    <div className="trick-center">
      <span className="trick-label">Play Area</span>
    </div>
    {/* Card slots for each player position */}
    <div className="trick-slot slot-top"></div>
    <div className="trick-slot slot-left"></div>
    <div className="trick-slot slot-right"></div>
    <div className="trick-slot slot-bottom"></div>
  </div>
);

// Kitty display
const KittyDisplay: React.FC<{ cardCount: number }> = ({ cardCount }) => (
  <div className="kitty-display">
    <div className="kitty-stack">
      {Array.from({ length: Math.min(cardCount, 3) }).map((_, i) => (
        <div key={i} className="kitty-card" style={{ transform: `translateY(${i * -2}px) rotate(${(i - 1) * 3}deg)` }}>
          <CardBack />
        </div>
      ))}
    </div>
    <span className="kitty-label">Kitty ({cardCount})</span>
  </div>
);

const GamePage: React.FC = () => {
  const sortedHand = sortCards(userHand);

  return (
    <div className="game-container">
      {/* Compact header */}
      <header className="game-header">
        <Link to="/" className="back-btn" aria-label="Leave game">
          ←
        </Link>
        <div className="game-status">
          <span className="game-code">ABC123</span>
          <div className="game-stats">
            <span className="stat">Bid: <strong>--</strong></span>
            <span className="stat">Trump: <strong>--</strong></span>
          </div>
        </div>
      </header>

      <main className="game-table">
        {/* Top opponent (across from user) - this is the partner */}
        <section className="table-section table-top">
          <PlayerInfo 
            name="Player 3" 
            cardCount={13} 
            position="top" 
            isPartner={true}
          />
        </section>

        {/* Middle section: side players + play area */}
        <section className="table-section table-middle">
          <PlayerInfo 
            name="Player 2" 
            cardCount={13} 
            position="left" 
            isCurrentTurn={true}
          />
          
          <div className="center-area">
            <TrickArea />
            <KittyDisplay cardCount={5} />
          </div>

          <PlayerInfo 
            name="Player 4" 
            cardCount={13} 
            position="right" 
          />
        </section>

        {/* Bottom: local player's hand */}
        <section className="table-section table-bottom">
          <div className="local-player">
            <div className="local-player-header">
              <div className="local-avatar">You</div>
              <span className="local-name">Player 1</span>
              <span className="card-count-badge">{sortedHand.length} cards</span>
            </div>
            <div className="hand-container">
              <div className="hand-scroll">
                {sortedHand.map((card, index) => (
                  <CardComponent 
                    key={index} 
                    card={card}
                    onClick={() => console.log('Played:', card)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default GamePage;
