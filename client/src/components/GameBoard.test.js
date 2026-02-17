import React from 'react';
import { render, screen } from '@testing-library/react';
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
});
