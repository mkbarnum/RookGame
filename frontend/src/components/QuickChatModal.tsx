import React from 'react';
import './QuickChatModal.css';

interface QuickChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMessage: (message: string) => void;
}

const QUICK_CHAT_MESSAGES = [
  'Good luck!',
  'Nice play!',
  'Good game!',
  'Hurry up!',
  'Who dealt these crappy cards?',
  'Here, kitty kitty!',
  'Bad kitty. Hiss!',
  "Good kitty. Meow.",
  'Oof',
  'My bad...',
  'Thanks partner!',
  'What are you doing???',
  'Why didn\'t you throw points?',
  'I have the rest',
  'Can we get set?',
  'Yes',
  'No',
  'Sure',
  'I don\'t care',
  'Who took the kitty?',
  'What\'s trump again?',
  'I only went 125...',
  'The Rook gods are displeased...',
  'Someone\'s not counting trump...'
];

export const QuickChatModal: React.FC<QuickChatModalProps> = ({
  isOpen,
  onClose,
  onSelectMessage,
}) => {
  if (!isOpen) return null;

  const handleMessageClick = (message: string) => {
    onSelectMessage(message);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content quick-chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Quick Chat</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close quick chat">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="quick-chat-options-container">
            {QUICK_CHAT_MESSAGES.map((message, index) => (
              <button
                key={index}
                className="quick-chat-option"
                onClick={() => handleMessageClick(message)}
              >
                {message}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
