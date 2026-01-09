import React from 'react';
import './SettingsModal.css';

export type CardSortMethod = 'left-to-right' | 'left-to-right-goofy' | 'right-to-left';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardSortMethod: CardSortMethod;
  onCardSortMethodChange: (method: CardSortMethod) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  cardSortMethod,
  onCardSortMethodChange,
}) => {
  if (!isOpen) return null;

  const sortOptions: { value: CardSortMethod; label: string; description: string }[] = [
    {
      value: 'left-to-right',
      label: 'Left to Right',
      description: '2 → 14, then 1 (Ace high)',
    },
    {
      value: 'left-to-right-goofy',
      label: 'Left to Right - Goofy',
      description: '1 → 14 (numeric order)',
    },
    {
      value: 'right-to-left',
      label: 'Right to Left',
      description: '1 ← 2 (high cards on right)',
    },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="settings-section">
            <h3 className="settings-section-title">Card Sort Method</h3>
            <div className="sort-options">
              {sortOptions.map((option) => (
                <label
                  key={option.value}
                  className={`sort-option ${cardSortMethod === option.value ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="cardSortMethod"
                    value={option.value}
                    checked={cardSortMethod === option.value}
                    onChange={() => onCardSortMethodChange(option.value)}
                  />
                  <div className="sort-option-content">
                    <span className="sort-option-label">{option.label}</span>
                    <span className="sort-option-description">{option.description}</span>
                  </div>
                  <div className="sort-option-check">
                    {cardSortMethod === option.value && '✓'}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
