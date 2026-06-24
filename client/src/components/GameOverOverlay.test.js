import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GameOverOverlay from './GameOverOverlay';
import { LanguageProvider } from '../i18n';

const makeGameState = (overrides = {}) => ({
  winner: { id: 'p1', name: 'Alice' },
  stockpileSize: 10,
  hostPlayerId: 'p1',
  players: [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Carol' },
  ],
  ...overrides,
});

const renderOverlay = (props = {}) => {
  const defaultProps = {
    gameState: makeGameState(),
    playerId: 'p1',
    rematchVotes: [],
    rematchStockpileSize: 10,
    onRequestRematch: jest.fn(),
    onRequestRematchWithoutDisconnected: jest.fn(),
    onUpdateRematchSettings: jest.fn(),
    onLeaveGame: jest.fn(),
  };
  return render(
    <LanguageProvider>
      <GameOverOverlay {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

const withDisconnectedCarol = () =>
  makeGameState({
    players: [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
      { id: 'p3', name: 'Carol', disconnected: true },
    ],
  });

describe('GameOverOverlay rematch without disconnected', () => {
  it('shows the control when a player is disconnected and enough remain', () => {
    renderOverlay({ gameState: withDisconnectedCarol() });
    expect(screen.getByText('Rematch without disconnected')).toBeInTheDocument();
  });

  it('hides the control when nobody is disconnected', () => {
    renderOverlay();
    expect(screen.queryByText('Rematch without disconnected')).not.toBeInTheDocument();
  });

  it('hides the control when too few players would remain', () => {
    renderOverlay({
      gameState: makeGameState({
        players: [
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: 'Bob', disconnected: true },
        ],
      }),
    });
    expect(screen.queryByText('Rematch without disconnected')).not.toBeInTheDocument();
  });

  it('calls onRequestRematchWithoutDisconnected when clicked', () => {
    const onRequestRematchWithoutDisconnected = jest.fn();
    renderOverlay({
      gameState: withDisconnectedCarol(),
      onRequestRematchWithoutDisconnected,
    });
    fireEvent.click(screen.getByText('Rematch without disconnected'));
    expect(onRequestRematchWithoutDisconnected).toHaveBeenCalledTimes(1);
  });

  it('tags disconnected players in the vote list', () => {
    renderOverlay({ gameState: withDisconnectedCarol() });
    expect(screen.getByText(/\(disconnected\)/)).toBeInTheDocument();
  });
});
