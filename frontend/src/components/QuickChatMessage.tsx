import React from 'react';
import './QuickChatMessage.css';

interface QuickChatMessageProps {
  message: string;
  position: 'top' | 'left' | 'right' | 'bottom';
}

export const QuickChatMessage: React.FC<QuickChatMessageProps> = ({
  message,
  position,
}) => {
  return (
    <div className={`quick-chat-bubble quick-chat-bubble-${position}`}>
      <div className="quick-chat-bubble-content">{message}</div>
      <div className={`quick-chat-bubble-tail quick-chat-bubble-tail-${position}`}></div>
    </div>
  );
};
