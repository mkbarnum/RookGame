import React, { useState } from 'react';
import { Player } from '../types/game';
import { API_BASE_URL } from '../config';
import './PartnerSelectionModal.css';

interface PartnerSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  players: Player[];
  gameId: string;
  onPartnerSelected: () => void;
}

export const PartnerSelectionModal: React.FC<PartnerSelectionModalProps> = ({
  isOpen,
  onClose,
  players,
  gameId,
  onPartnerSelected,
}) => {
  const [isSelectingPartner, setIsSelectingPartner] = useState(false);
  
  // Get other players (not the host)
  const otherPlayers = players.filter(p => p.seat !== 0);
  
  // Handle partner selection
  const handleChoosePartner = async (partnerSeat: number) => {
    if (isSelectingPartner) return;
    
    setIsSelectingPartner(true);
    try {
      const response = await fetch(`${API_BASE_URL}/choosePartner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          partnerSeat,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to select partner');
      }

      console.log('Partner selected:', data);
      
      // Close modal and refresh game state
      onClose();
      onPartnerSelected();
    } catch (error) {
      console.error('Error selecting partner:', error);
      alert(error instanceof Error ? error.message : 'Failed to select partner');
    } finally {
      setIsSelectingPartner(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Choose Your Partner</h2>
          <button className="modal-close" onClick={onClose} type="button">×</button>
        </div>
        <div className="modal-body">
          <div className="partner-options">
            {otherPlayers.map(player => (
              <button
                key={player.seat}
                type="button"
                className="partner-btn"
                onClick={() => handleChoosePartner(player.seat)}
                disabled={isSelectingPartner}
              >
                <div className="partner-avatar">{player.name[0].toUpperCase()}</div>
                <div className="partner-name">{player.name}</div>
                {isSelectingPartner && <div className="partner-loading">...</div>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
