import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GameBoard from './GameBoard';
import { LanguageProvider } from '../i18n';

const makeGameState = (overrides = {}) => ({
  roomId: 'TESTROOM',
  players: [
    {
      id: 'p1',
      name: 'Alice',
      stockpileCount: 30,
      stockpileTop: 5,
      handCount: 5,
      discardPiles: [[], [], [], []],
    },
    {
      id: 'p2',
      name: 'Bob',
      stockpileCount: 30,
      stockpileTop: 3,
      handCount: 5,
      discardPiles: [[], [], [], []],
    },
  ],
  buildingPiles: [[], [], [], []],
  currentPlayerIndex: 0,
  currentPlayerId: 'p1',
  deckCount: 92,
  gameStarted: true,
  gameOver: false,
  winner: null,
  ...overrides,
});

const makePlayerState = (overrides = {}) => ({
  hand: [1, 3, 5, 7, 9],
  stockpile: Array(30).fill(0),
  stockpileTop: 5,
  discardPiles: [[], [], [], []],
  ...overrides,
});

const defaultProps = {
  gameState: makeGameState(),
  playerState: makePlayerState(),
  playerId: 'p1',
  roomId: 'TESTROOM',
  onStartGame: jest.fn(),
  onPlayCard: jest.fn(),
  onDiscardCard: jest.fn(),
  onEndTurn: jest.fn(),
  onLeaveLobby: jest.fn(),
  onLeaveGame: jest.fn(),
  chatMessages: [],
  onSendChatMessage: jest.fn(),
  onMarkMessagesRead: jest.fn(),
  stablePlayerId: 'stable-p1',
};

const renderGameBoard = (props = {}) => {
  return render(
    <LanguageProvider>
      <GameBoard {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

describe('GameBoard', () => {
  describe('loading state', () => {
    it('shows loading when gameState is null', () => {
      renderGameBoard({ gameState: null });
      expect(screen.getByText('Loading game...')).toBeInTheDocument();
    });
  });

  describe('waiting room (game not started)', () => {
    const waitingProps = {
      gameState: makeGameState({ gameStarted: false }),
      playerState: null,
    };

    it('renders room ID', () => {
      renderGameBoard(waitingProps);
      expect(screen.getByText('Room: TESTROOM')).toBeInTheDocument();
    });

    it('renders shareable link input', () => {
      renderGameBoard(waitingProps);
      const linkInput = screen.getByDisplayValue(/\?room=TESTROOM/);
      expect(linkInput).toBeInTheDocument();
    });

    it('renders player list', () => {
      renderGameBoard(waitingProps);
      expect(screen.getByText(/Alice/)).toBeInTheDocument();
      expect(screen.getByText(/Bob/)).toBeInTheDocument();
    });

    it('shows start game button when 2+ players', () => {
      renderGameBoard(waitingProps);
      expect(screen.getByText('Start Game')).toBeInTheDocument();
    });

    it('calls onStartGame when start button is clicked', () => {
      const onStartGame = jest.fn();
      renderGameBoard({ ...waitingProps, onStartGame });
      fireEvent.click(screen.getByText('Start Game'));
      expect(onStartGame).toHaveBeenCalled();
    });

    it('shows waiting message when fewer than 2 players', () => {
      renderGameBoard({
        gameState: makeGameState({
          gameStarted: false,
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
        playerState: null,
      });
      expect(screen.getByText('Waiting for more players to join...')).toBeInTheDocument();
    });

    it('renders leave button', () => {
      renderGameBoard(waitingProps);
      expect(screen.getByText('Leave Game')).toBeInTheDocument();
    });

    it('calls onLeaveLobby when leave button is clicked', () => {
      const onLeaveLobby = jest.fn();
      renderGameBoard({ ...waitingProps, onLeaveLobby });
      fireEvent.click(screen.getByText('Leave Game'));
      expect(onLeaveLobby).toHaveBeenCalled();
    });
  });
});
