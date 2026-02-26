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
  stockpileCount: 30,
  stockpileTop: 5,
  discardPiles: [[], [], [], []],
  ...overrides,
});

const defaultProps = {
  gameState: makeGameState(),
  playerState: makePlayerState(),
  playerId: 'p1',
  roomId: 'TESTROOM',
  onPlayCard: jest.fn(),
  onDiscardCard: jest.fn(),
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

  describe('active game', () => {
    it('renders room ID in game header', () => {
      renderGameBoard();
      expect(screen.getByText('Room: TESTROOM')).toBeInTheDocument();
    });

    it('shows "Your Turn" when it is the player turn', () => {
      renderGameBoard();
      expect(screen.getByText('Your Turn!')).toBeInTheDocument();
    });

    it('shows waiting message when it is not the player turn', () => {
      renderGameBoard({
        gameState: makeGameState({ currentPlayerId: 'p2' }),
      });
      expect(screen.getByText('Waiting for other player...')).toBeInTheDocument();
    });

    it('renders building piles section', () => {
      renderGameBoard();
      expect(screen.getByText('Building Piles')).toBeInTheDocument();
    });

    it('renders 4 empty building piles with "Start with 1" text', () => {
      renderGameBoard();
      const startTexts = screen.getAllByText('Start with 1');
      expect(startTexts).toHaveLength(4);
    });

    it('renders opponent info', () => {
      renderGameBoard();
      expect(screen.getByText(/Bob/)).toBeInTheDocument();
    });

    it('renders player area', () => {
      renderGameBoard();
      expect(screen.getByText('Your Area')).toBeInTheDocument();
    });

    it('renders player hand', () => {
      renderGameBoard();
      expect(screen.getByText('Your Hand')).toBeInTheDocument();
    });

    it('renders end turn button on player turn', () => {
      renderGameBoard();
      expect(screen.getByText('End Turn (Discard a Card)')).toBeInTheDocument();
    });

    it('does not render end turn button when not player turn', () => {
      renderGameBoard({
        gameState: makeGameState({ currentPlayerId: 'p2' }),
      });
      expect(screen.queryByText('End Turn (Discard a Card)')).not.toBeInTheDocument();
    });

    it('renders leave game button', () => {
      renderGameBoard();
      expect(screen.getByText('Leave Game')).toBeInTheDocument();
    });

    it('shows leave confirmation dialog on leave click', () => {
      renderGameBoard();
      fireEvent.click(screen.getByText('Leave Game'));
      expect(screen.getByText('Are you sure you want to leave the game?')).toBeInTheDocument();
    });

    it('shows top card on non-empty building pile', () => {
      renderGameBoard({
        gameState: makeGameState({
          buildingPiles: [[1, 2, 3], [], [], []],
        }),
      });
      // 3 empty piles show "Start with 1", the filled pile does not
      expect(screen.getAllByText('Start with 1')).toHaveLength(3);
      // Next card hint appears for the non-empty pile
      expect(screen.getByText('Next: 4')).toBeInTheDocument();
    });

    it('shows discard instruction after clicking End Turn', () => {
      renderGameBoard();
      fireEvent.click(screen.getByText('End Turn (Discard a Card)'));
      expect(
        screen.getByText('Place a card on one of your discard piles to end your turn')
      ).toBeInTheDocument();
    });

    it('shows disconnected indicator for opponent', () => {
      renderGameBoard({
        gameState: makeGameState({
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
              disconnected: true,
            },
          ],
        }),
      });
      expect(screen.getByText('(Disconnected)')).toBeInTheDocument();
    });

    it('renders quick discard checkbox', () => {
      renderGameBoard();
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
      expect(
        screen.getByText('Quick Discard (click discard pile with selected card)')
      ).toBeInTheDocument();
    });

    it('renders stockpile card in player area', () => {
      renderGameBoard();
      expect(screen.getByText(/Your Stockpile/)).toBeInTheDocument();
      // stockpileTop is 5, so there should be a visible card rendered
      expect(screen.getByText('Your Stockpile (30)')).toBeInTheDocument();
    });
  });

  describe('game over', () => {
    it('shows game over overlay with winner name', () => {
      renderGameBoard({
        gameState: makeGameState({
          gameOver: true,
          winner: { name: 'Alice' },
        }),
      });
      expect(screen.getByText('Game Over!')).toBeInTheDocument();
      expect(screen.getByText('Winner: Alice')).toBeInTheDocument();
    });
  });
});
