import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Chat from './Chat';
import { LanguageProvider } from '../i18n';

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

const renderChat = (props = {}) => {
  const defaultProps = {
    messages: [],
    onSendMessage: jest.fn(),
    onMarkMessagesRead: jest.fn(),
    stablePlayerId: 'my-stable-id',
  };
  return render(
    <LanguageProvider>
      <Chat {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

describe('Chat', () => {
  it('renders collapsed by default', () => {
    renderChat();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type a message...')).not.toBeInTheDocument();
  });

  it('expands on header click', () => {
    renderChat();
    fireEvent.click(screen.getByText('Chat'));
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('shows "no messages" when expanded with empty messages', () => {
    renderChat();
    fireEvent.click(screen.getByText('Chat'));
    expect(screen.getByText('No messages yet. Start chatting!')).toBeInTheDocument();
  });

  it('renders message with author and text', () => {
    const messages = [
      {
        playerName: 'Alice',
        message: 'Hello world',
        stablePlayerId: 'other-id',
        timestamp: Date.now(),
      },
    ];
    renderChat({ messages });
    fireEvent.click(screen.getByText('Chat'));
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('calls onSendMessage on form submit', () => {
    const onSendMessage = jest.fn();
    renderChat({ onSendMessage });
    fireEvent.click(screen.getByText('Chat'));

    fireEvent.change(screen.getByPlaceholderText('Type a message...'), {
      target: { value: 'Hi there' },
    });
    fireEvent.click(screen.getByText('Send'));

    expect(onSendMessage).toHaveBeenCalledWith('Hi there');
  });

  it('clears input after sending', () => {
    renderChat();
    fireEvent.click(screen.getByText('Chat'));

    const input = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByText('Send'));

    expect(input.value).toBe('');
  });

  it('shows unread badge for messages from others', () => {
    const messages = [
      {
        playerName: 'Bob',
        message: 'Hey',
        stablePlayerId: 'other-id',
        timestamp: Date.now(),
        read: false,
      },
      {
        playerName: 'Bob',
        message: 'You there?',
        stablePlayerId: 'other-id',
        timestamp: Date.now(),
        read: false,
      },
    ];
    renderChat({ messages });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does not count own messages as unread', () => {
    const messages = [
      {
        playerName: 'Me',
        message: 'My message',
        stablePlayerId: 'my-stable-id',
        timestamp: Date.now(),
        read: false,
      },
    ];
    renderChat({ messages });
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
