import React, { useState, useEffect, useRef } from 'react';
import './Chat.css';
import { useTranslation } from '../i18n';

function Chat({ messages, onSendMessage, onMarkMessagesRead, playerId }) {
  const { t } = useTranslation();
  const [inputMessage, setInputMessage] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Only scroll to bottom when chat is first expanded, not on every message
  useEffect(() => {
    if (isExpanded) {
      scrollToBottom();
      // Mark all messages as read when chat is opened
      if (onMarkMessagesRead) {
        onMarkMessagesRead();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputMessage.trim()) {
      onSendMessage(inputMessage);
      setInputMessage('');
      // Scroll to bottom after sending your own message
      setTimeout(() => scrollToBottom(), 100);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isOwnMessage = (msg) => {
    // Use stable player ID that persists across reconnections
    return msg.stablePlayerId === playerId;
  };

  const unreadCount = messages.filter((msg) => !msg.read && !isOwnMessage(msg)).length;

  return (
    <div className={`chat-container ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="chat-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="chat-header-content">
          <span className="chat-icon">💬</span>
          <span className="chat-title">{t('chat.title')}</span>
          <span className="toggle-icon">{isExpanded ? '▼' : '▲'}</span>
        </div>
        {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
      </div>

      {isExpanded && (
        <>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="no-messages">{t('chat.noMessages')}</div>
            ) : (
              messages.map((msg, index) => (
                <div
                  key={`${msg.timestamp}-${msg.stablePlayerId}-${index}`}
                  className={`chat-message ${isOwnMessage(msg) ? 'own-message' : 'other-message'}`}
                >
                  <div className="message-header">
                    <span className="message-author">{msg.playerName}</span>
                    <span className="message-time">{formatTime(msg.timestamp)}</span>
                  </div>
                  <div className="message-text">{msg.message}</div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-input-form" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder={t('chat.placeholder')}
              maxLength={200}
              className="chat-input"
            />
            <button type="submit" className="chat-send-button" disabled={!inputMessage.trim()}>
              {t('chat.send')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default Chat;
