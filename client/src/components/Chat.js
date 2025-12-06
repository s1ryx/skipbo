import React, { useState, useEffect, useRef } from 'react';
import './Chat.css';

function Chat({ messages, onSendMessage, onMarkMessagesRead, stablePlayerId }) {
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
      minute: '2-digit'
    });
  };

  const isOwnMessage = (msg) => {
    // Use stable player ID that persists across reconnections
    return msg.stablePlayerId === stablePlayerId;
  };

  const unreadCount = messages.filter(msg =>
    !msg.read && !isOwnMessage(msg)
  ).length;

  return (
    <div className={`chat-container ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div
        className="chat-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="chat-header-content">
          <span className="chat-icon">💬</span>
          <span className="chat-title">Chat</span>
          <span className="toggle-icon">{isExpanded ? '▼' : '▲'}</span>
        </div>
        {unreadCount > 0 && (
          <span className="unread-badge">{unreadCount}</span>
        )}
      </div>

      {isExpanded && (
        <>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="no-messages">No messages yet. Start chatting!</div>
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
              placeholder="Type a message..."
              maxLength={200}
              className="chat-input"
            />
            <button
              type="submit"
              className="chat-send-button"
              disabled={!inputMessage.trim()}
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default Chat;
