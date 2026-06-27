import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GameOverOverlay from './GameOverOverlay';
import { LanguageProvider } from '../i18n';

const renderOverlay = (props = {}) => {
  const defaultProps = {
    gameState: {
      winner: { id: 'p1', name: 'Alice' },
      finishedAt: Date.now() - 11000, // savor window already elapsed
      players: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
    },
    onReturnToLobby: jest.fn(),
    onLeaveGame: jest.fn(),
  };
  return render(
    <LanguageProvider>
      <GameOverOverlay {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

describe('GameOverOverlay', () => {
  it('shows the winner', () => {
    renderOverlay();
    expect(screen.getByText('Winner: Alice')).toBeInTheDocument();
  });

  it('enables Back to room once the savor window has passed', () => {
    const onReturnToLobby = jest.fn();
    renderOverlay({ onReturnToLobby });

    const button = screen.getByText('Back to room');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onReturnToLobby).toHaveBeenCalledTimes(1);
  });

  it('disables Back to room during the savor window', () => {
    renderOverlay({
      gameState: {
        winner: { id: 'p1', name: 'Alice' },
        finishedAt: Date.now(),
        players: [],
      },
    });

    expect(screen.getByRole('button', { name: /Back to room/ })).toBeDisabled();
  });

  it('calls onLeaveGame when Leave is clicked', () => {
    const onLeaveGame = jest.fn();
    renderOverlay({ onLeaveGame });

    fireEvent.click(screen.getByText('Leave'));
    expect(onLeaveGame).toHaveBeenCalledTimes(1);
  });
});
