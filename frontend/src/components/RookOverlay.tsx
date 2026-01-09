import React from 'react';
import rookGif from '../assets/rook.gif';
import './RookOverlay.css';

interface RookOverlayProps {
  show: boolean;
}

export const RookOverlay: React.FC<RookOverlayProps> = ({ show }) => {
  React.useEffect(() => {
    if (show) {
      console.log('🦅 RookOverlay: Showing overlay');
    }
  }, [show]);

  if (!show) return null;

  return (
    <div className="rook-overlay">
      <img src={rookGif} alt="Rook" className="rook-overlay-image" />
    </div>
  );
};
