import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WaitingRoom from './WaitingRoom';
import { LanguageProvider } from '../i18n';

const makeGameState = (overrides = {}) => ({
  roomId: 'TESTROOM',
  players: [
    {
      id: 'p1',
      name: 'Alice',
      stockpileCount: 0,
      handCount: 0,
      discardPiles: [[], [], [], []],
    },
    {
      id: 'p2',
      name: 'Bob',
      stockpileCount: 0,
      handCount: 0,
      discardPiles: [[], [], [], []],
    },
  ],
  buildingPiles: [[], [], [], []],
  currentPlayerIndex: 0,
  currentPlayerId: 'p1',
  hostPlayerId: 'p1',
  deckCount: 100,
  gameStarted: false,
  gameOver: false,
  winner: null,
  ...overrides,
});

const defaultProps = {
  gameState: makeGameState(),
  playerId: 'p1',
  roomId: 'TESTROOM',
  onStartGame: jest.fn(),
  onLeaveLobby: jest.fn(),
};

const renderWaitingRoom = (props = {}) => {
  return render(
    <LanguageProvider>
      <WaitingRoom {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

describe('WaitingRoom', () => {
  it('shows loading when gameState is null', () => {
    renderWaitingRoom({ gameState: null });
    expect(screen.getByText('Loading game...')).toBeInTheDocument();
  });

  it('renders room ID', () => {
    renderWaitingRoom();
    expect(screen.getByText('Room: TESTROOM')).toBeInTheDocument();
  });

  it('renders shareable link input', () => {
    renderWaitingRoom();
    const linkInput = screen.getByDisplayValue(/\?room=TESTROOM/);
    expect(linkInput).toBeInTheDocument();
  });

  it('renders player list', () => {
    renderWaitingRoom();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it('shows start game button when 2+ players', () => {
    renderWaitingRoom();
    expect(screen.getByText('Start Game')).toBeInTheDocument();
  });

  it('calls onStartGame when start button is clicked', () => {
    const onStartGame = jest.fn();
    renderWaitingRoom({ onStartGame });
    fireEvent.click(screen.getByText('Start Game'));
    expect(onStartGame).toHaveBeenCalled();
  });

  it('shows waiting message when fewer than 2 players', () => {
    renderWaitingRoom({
      gameState: makeGameState({
        players: [
          {
            id: 'p1',
            name: 'Alice',
            stockpileCount: 0,
            handCount: 0,
            discardPiles: [[], [], [], []],
          },
        ],
      }),
    });
    expect(screen.getByText('Waiting for more players to join...')).toBeInTheDocument();
  });

  it('renders leave button', () => {
    renderWaitingRoom();
    expect(screen.getByText('Leave Game')).toBeInTheDocument();
  });

  it('calls onLeaveLobby when leave button is clicked', () => {
    const onLeaveLobby = jest.fn();
    renderWaitingRoom({ onLeaveLobby });
    fireEvent.click(screen.getByText('Leave Game'));
    expect(onLeaveLobby).toHaveBeenCalled();
  });

  it('hides start button for non-host player', () => {
    renderWaitingRoom({ playerId: 'p2' });
    expect(screen.queryByText('Start Game')).not.toBeInTheDocument();
  });

  it('shows start button for host player', () => {
    renderWaitingRoom({ playerId: 'p1' });
    expect(screen.getByText('Start Game')).toBeInTheDocument();
  });
});
