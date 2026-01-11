import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { cardToString } from '../utils/cardUtils';
import './CardFan.css';

interface CardFanProps {
  cards: CardType[];
  onCardPlay: (card: CardType) => void;
  isCardPlayable: (card: CardType) => boolean;
  isMyTurn: boolean;
  isDealing?: boolean;
  dealtCardCount?: number; // Number of cards that have been dealt to hand
}

export const CardFan: React.FC<CardFanProps> = ({
  cards,
  onCardPlay,
  isCardPlayable,
  isMyTurn,
  isDealing = false,
  dealtCardCount = 0,
}) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCardDragging, setIsCardDragging] = useState(false); // Native card drag state
  const [isTouchDragging, setIsTouchDragging] = useState(false); // Touch-based drag state
  const [touchDraggedCard, setTouchDraggedCard] = useState<CardType | null>(null);
  const [touchStartPos, setTouchStartPos] = useState<{x: number, y: number} | null>(null);
  const [touchCurrentPos, setTouchCurrentPos] = useState<{x: number, y: number} | null>(null);
  const [touchDraggedElement, setTouchDraggedElement] = useState<HTMLElement | null>(null);
  const [touchDragClone, setTouchDragClone] = useState<HTMLElement | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [flippedIndices, setFlippedIndices] = useState<Set<number>>(new Set());
  const [flippingIndices, setFlippingIndices] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startDragOffsetRef = useRef(0);
  const flipTimeoutRefs = useRef<NodeJS.Timeout[]>([]);

  const totalCards = cards.length;
  const topRowMaxCards = 6;
  const bottomRowMaxCards = 7;
  
  // Split cards into two rows
  // Top row gets first 6 cards, bottom row gets remaining 7 cards
  const topRowCards = Math.min(totalCards, topRowMaxCards);
  const bottomRowCards = Math.max(0, Math.min(totalCards - topRowMaxCards, bottomRowMaxCards));
  
  // Calculate fan parameters based on row card count
  const getRowParams = (rowCardCount: number) => {
    const maxArcAngle = Math.min(40, 15 + rowCardCount * 1.5);
    const angleStep = rowCardCount > 1 ? maxArcAngle / (rowCardCount - 1) : 0;
    const startAngle = -maxArcAngle / 2;
    return { maxArcAngle, angleStep, startAngle };
  };

  const topRowParams = getRowParams(topRowCards);
  const bottomRowParams = getRowParams(bottomRowCards);

  // Calculate card position and rotation
  const getCardStyle = (index: number): React.CSSProperties => {
    // Top row is index < 6, bottom row is index >= 6
    const isTopRow = index < topRowMaxCards;
    const rowIndex = isTopRow ? index : index - topRowMaxCards;
    const rowCardCount = isTopRow ? topRowCards : bottomRowCards;
    const rowParams = isTopRow ? topRowParams : bottomRowParams;
    
    // Calculate angle for this row
    const baseAngle = rowParams.startAngle + rowIndex * rowParams.angleStep;
    
    // Apply drag offset to the angle calculation
    const dragAngleOffset = dragOffset * 0.15; // Convert pixels to degrees
    const angle = baseAngle + dragAngleOffset;
    
    // Vertical position: top row above, bottom row at bottom
    // Row spacing: reduced to create more overlap between rows
    const rowYOffset = isTopRow ? -80 : 0; // Top row is 80px above bottom row (reduced for more overlap)
    const normalizedPos = (rowIndex - (rowCardCount - 1) / 2) / Math.max(1, (rowCardCount - 1) / 2);
    const yOffset = rowYOffset + (normalizedPos * normalizedPos * 8); // Very gentle curve
    
    // Calculate horizontal spread - spread cards across the full width
    // Increased spacing to accommodate larger cards (30% larger)
    const cardSpacing = 29; // Pixels between card centers (22 * 1.3 = 28.6)
    const totalWidth = (rowCardCount - 1) * cardSpacing;
    const xOffset = (rowIndex * cardSpacing) - (totalWidth / 2);
    
    // Z-index: bottom row should overlay top row
    // Bottom row gets higher z-index so it appears on top
    const baseZIndex = isTopRow ? (index + 1) : (index + 1 + 200); // Bottom row on top, top row behind
    
    return {
      '--rotation': `${angle}deg`,
      '--y-offset': `${yOffset}px`,
      '--x-offset': `${xOffset}px`,
      '--z-index': baseZIndex,
      '--scale': 1, // No scaling on hover/focus
      '--lift': '0px', // No lift effect - cards should never raise
      '--transition-delay': `${index * 15}ms`,
    } as React.CSSProperties;
  };

  // Handle touch/mouse start
  const handleDragStart = useCallback((clientX: number) => {
    setIsDragging(true);
    startXRef.current = clientX;
    startDragOffsetRef.current = dragOffset;
  }, [dragOffset]);

  // Handle touch/mouse move
  const handleDragMove = useCallback((clientX: number) => {
    if (!isDragging) return;
    
    const delta = clientX - startXRef.current;
    const newOffset = startDragOffsetRef.current + delta;
    
    // Limit the drag range
    const maxOffset = (totalCards - 1) * 25;
    const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, newOffset));
    
    setDragOffset(clampedOffset);
    
    // Update focused card based on drag position
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const cardWidth = rect.width / totalCards;
      const newIndex = Math.floor(relativeX / cardWidth);
      const clampedIndex = Math.max(0, Math.min(totalCards - 1, newIndex));
      setFocusedIndex(clampedIndex);
    }
  }, [isDragging, totalCards]);

  // Handle touch/mouse end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    // Snap back to center with smooth animation
    setDragOffset(0);
  }, []);

  // Mouse event handlers - allow fan scrolling when not my turn (for viewing), but disable when my turn (for drag/drop)
  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't interfere with native drag on draggable elements
    const target = e.target as HTMLElement;
    if (target.closest('[draggable="true"]') || isCardDragging) {
      return;
    }
    // Allow fan scrolling when not my turn (to view cards), but disable when my turn (so drag/drop works)
    if (!isMyTurn) {
      e.preventDefault();
      handleDragStart(e.clientX);
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    handleDragMove(e.clientX);
  }, [handleDragMove]);

  const handleMouseUp = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Touch event handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    const draggableElement = target.closest('[draggable="true"]') as HTMLElement;
    const touch = e.touches[0];

    // If touching a draggable card, start touch drag
    if (draggableElement && !isCardDragging) {
      const cardIndex = parseInt(draggableElement.getAttribute('data-card-index') || '0');
      const card = cards[cardIndex];
      const canDrag = isMyTurn && isCardPlayable(card);

      if (canDrag) {
        e.preventDefault();
        setIsTouchDragging(true);
        setTouchDraggedCard(card);
        setTouchStartPos({ x: touch.clientX, y: touch.clientY });
        setTouchDraggedElement(draggableElement);
        // Don't create clone yet - wait until user actually drags
        return;
      }
    }

    // Don't interfere with native drag on draggable elements
    if (target.closest('[draggable="true"]') || isCardDragging) {
      return;
    }

    // Allow fan scrolling when not my turn (to view cards), but disable when my turn (so drag/drop works)
    if (!isMyTurn) {
      handleDragStart(touch.clientX);
    }
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    setTouchCurrentPos({ x: touch.clientX, y: touch.clientY });

    if (isTouchDragging && touchDraggedCard && touchStartPos && touchDraggedElement) {
      // Check if touch moved significantly to confirm drag intent
      const deltaX = Math.abs(touch.clientX - touchStartPos.x);
      const deltaY = Math.abs(touch.clientY - touchStartPos.y);
      const minDragDistance = 20; // Minimum distance to consider it a drag

      // Create clone only after user has actually started dragging
      if (!touchDragClone && (deltaX > minDragDistance || deltaY > minDragDistance)) {
        const cardElement = touchDraggedElement.querySelector('.card') as HTMLElement;
        if (cardElement) {
          const clone = cardElement.cloneNode(true) as HTMLElement;
          // Preserve original classes and add drag clone class
          clone.className = `${cardElement.className} card-touch-drag-clone`;
          clone.style.position = 'fixed';
          clone.style.left = `${touch.clientX - 26}px`;
          clone.style.top = `${touch.clientY - 36}px`;
          clone.style.zIndex = '9999';
          clone.style.pointerEvents = 'none';
          clone.style.transform = 'scale(1.1)';
          document.body.appendChild(clone);
          setTouchDragClone(clone);
          // Hide the original card only after drag starts
          touchDraggedElement.style.opacity = '0.3';
        }
      }

      // Move the clone if it exists
      if (touchDragClone) {
        touchDragClone.style.left = `${touch.clientX - 26}px`; // Center on touch (half card width)
        touchDragClone.style.top = `${touch.clientY - 36}px`;  // Center on touch (half card height)

        // Check if touch is over the drop zone (trick area)
        const trickArea = document.querySelector('.trick-area');
        if (trickArea) {
          const rect = trickArea.getBoundingClientRect();
          const isOverDropZone = (
            touch.clientX >= rect.left &&
            touch.clientX <= rect.right &&
            touch.clientY >= rect.top &&
            touch.clientY <= rect.bottom
          );

          // Update visual feedback
          trickArea.classList.toggle('drag-over', isOverDropZone);
        }
      }
    } else {
      // Handle fan scrolling
      handleDragMove(touch.clientX);
    }
  }, [isTouchDragging, touchDraggedCard, touchStartPos, touchDraggedElement, touchDragClone, handleDragMove]);

  // Cleanup function for touch drag
  const cleanupTouchDrag = useCallback(() => {
    // Get current state values directly from DOM/state
    const draggingElement = document.querySelector('.card-fan-slot[style*="opacity: 0.3"]') as HTMLElement;
    const clone = document.querySelector('.card-touch-drag-clone') as HTMLElement;
    const trickArea = document.querySelector('.trick-area');

    // Restore original element
    if (draggingElement) {
      draggingElement.style.opacity = '';
    }

    // Remove clone if it exists
    if (clone && clone.parentNode) {
      clone.parentNode.removeChild(clone);
    }

    // Remove drag-over class
    if (trickArea) {
      trickArea.classList.remove('drag-over');
    }

    // Reset state
    setIsTouchDragging(false);
    setTouchDraggedCard(null);
    setTouchStartPos(null);
    setTouchCurrentPos(null);
    setTouchDraggedElement(null);
    setTouchDragClone(null);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isTouchDragging && touchDraggedCard) {
      // Check if touch ended over the drop zone (use currentPos if available, otherwise startPos)
      const finalPos = touchCurrentPos || touchStartPos;
      const trickArea = document.querySelector('.trick-area');
      let isOverDropZone = false;

      if (trickArea && finalPos) {
        const rect = trickArea.getBoundingClientRect();
        isOverDropZone = (
          finalPos.x >= rect.left &&
          finalPos.x <= rect.right &&
          finalPos.y >= rect.top &&
          finalPos.y <= rect.bottom
        );

        if (isOverDropZone) {
          // Trigger drop action
          const dropEvent = new CustomEvent('cardDropped', {
            detail: { card: touchDraggedCard }
          });
          trickArea.dispatchEvent(dropEvent);
        }
      }

      // Always cleanup
      cleanupTouchDrag();
    } else {
      handleDragEnd();
    }
  }, [isTouchDragging, touchDraggedCard, touchCurrentPos, touchStartPos, cleanupTouchDrag, handleDragEnd]);

  const handleTouchCancel = useCallback(() => {
    // Always cleanup on touch cancel
    if (isTouchDragging) {
      cleanupTouchDrag();
    }
  }, [isTouchDragging, cleanupTouchDrag]);

  // Add global mouse/touch listeners when dragging
  useEffect(() => {
    if (isDragging || isTouchDragging) {
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
      window.addEventListener('touchcancel', handleTouchCancel);

      if (!isTouchDragging) {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      }

      return () => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
        window.removeEventListener('touchcancel', handleTouchCancel);

        if (!isTouchDragging) {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
        }
      };
    }
  }, [isDragging, isTouchDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  // Cleanup on unmount - remove any lingering clones
  useEffect(() => {
    return () => {
      const clones = document.querySelectorAll('.card-touch-drag-clone');
      clones.forEach(clone => {
        if (clone.parentNode) {
          clone.parentNode.removeChild(clone);
        }
      });
    };
  }, []);

  // Handle deal animation: flip cards sequentially (only after all cards are dealt)
  useEffect(() => {
    // Clear any existing timeouts
    flipTimeoutRefs.current.forEach(timeout => clearTimeout(timeout));
    flipTimeoutRefs.current = [];

    // Only start flip animation when all cards are dealt and we're in flipping phase
    const allCardsDealt = dealtCardCount >= cards.length && cards.length > 0;
    if (!isDealing || !allCardsDealt || cards.length === 0) {
      // Reset state when not dealing or not all cards dealt yet
      if (!isDealing) {
        setFlippedIndices(new Set());
        setFlippingIndices(new Set());
      }
      return;
    }

    // Start with all cards face down
    setFlippedIndices(new Set());
    setFlippingIndices(new Set());

    const totalCards = cards.length;

    // Flip cards one by one with 100ms delay between each
    for (let index = 0; index < totalCards; index++) {
      const timeout = setTimeout(() => {
        // Mark card as flipping
        setFlippingIndices(prev => new Set(prev).add(index));
        
        // After flip animation completes (300ms), mark as flipped
        const flipCompleteTimeout = setTimeout(() => {
          setFlippedIndices(prev => {
            const newSet = new Set(prev);
            newSet.add(index);
            return newSet;
          });
          setFlippingIndices(prev => {
            const newSet = new Set(prev);
            newSet.delete(index);
            return newSet;
          });
        }, 300); // Match CSS transition duration
        
        flipTimeoutRefs.current.push(flipCompleteTimeout);
      }, index * 100); // 100ms delay between each card
      
      flipTimeoutRefs.current.push(timeout);
    }

    // Cleanup function
    return () => {
      flipTimeoutRefs.current.forEach(timeout => clearTimeout(timeout));
      flipTimeoutRefs.current = [];
    };
  }, [isDealing, dealtCardCount, cards.length]); // Depend on dealtCardCount to trigger flip when all cards are dealt

  // Handle card focus on hover (desktop) - disabled, cards should not raise
  const handleCardHover = (index: number) => {
    // Cards should never raise on hover - this is disabled
  };

  // Handle card unfocus
  const handleCardLeave = () => {
    // Cards should never raise on hover - this is disabled
  };

  // Handle card tap/click - disabled, cards should only be drag/dropped
  const handleCardTap = (index: number, card: CardType) => {
    // No tap interaction - cards should only be drag/dropped when it's my turn
  };

  if (cards.length === 0) {
    return (
      <div className="card-fan-empty">
        <p>Waiting for cards to be dealt...</p>
      </div>
    );
  }

  return (
    <div 
      className={`card-fan-container ${isDragging ? 'dragging' : ''}`}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onMouseLeave={handleCardLeave}
    >
      <div className="card-fan">
        {cards.map((card, index) => {
          // Only render cards that have been dealt (or all cards if not dealing)
          if (isDealing && index >= dealtCardCount) {
            return null;
          }
          
          const playable = isCardPlayable(card);
          const canDrag = isMyTurn && playable;
          
          return (
            <div
              key={`${card.color}-${card.rank}-${index}`}
              className={`card-fan-slot ${!playable && isMyTurn ? 'not-playable' : ''} ${isDealing && index < dealtCardCount ? 'just-dealt' : ''} ${!isMyTurn ? 'not-my-turn' : ''}`}
              style={getCardStyle(index)}
              data-card-index={index}
              onMouseEnter={() => handleCardHover(index)}
              onClick={() => handleCardTap(index, card)}
              draggable={canDrag}
              onDragStart={(e) => {
                if (!canDrag) {
                  e.preventDefault();
                  return;
                }
                e.stopPropagation();
                setIsCardDragging(true);
                
                // Store card data for the drop handler
                const cardData = JSON.stringify({
                  cardString: cardToString(card),
                  card: card,
                });
                e.dataTransfer.setData('application/rook-card', cardData);
                e.dataTransfer.effectAllowed = 'move';
                
                // Set a drag image (use the current target)
                const dragElement = e.currentTarget as HTMLElement;
                const rect = dragElement.getBoundingClientRect();
                e.dataTransfer.setDragImage(dragElement, rect.width / 2, rect.height / 2);
                
                // Add dragging class to the slot
                dragElement.classList.add('dragging');
              }}
              onDragEnd={(e) => {
                e.stopPropagation();
                setIsCardDragging(false);
                (e.currentTarget as HTMLElement).classList.remove('dragging');
              }}
            >
              <Card
                card={card}
                disabled={!isMyTurn || !playable}
                isFaceDown={isDealing && index < dealtCardCount && !flippedIndices.has(index)}
                isFlipping={flippingIndices.has(index)}
              />
            </div>
          );
        })}
      </div>
      
      {/* Visual indicator - removed, no hover/focus feedback */}
    </div>
  );
};
