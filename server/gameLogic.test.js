const SkipBoGame = require('./gameLogic');

describe('SkipBoGame', () => {
  let game;

  beforeEach(() => {
    game = new SkipBoGame('TESTROOM', 2, null);
  });

  describe('constructor', () => {
    it('initializes with correct defaults', () => {
      expect(game.roomId).toBe('TESTROOM');
      expect(game.playerCount).toBe(2);
      expect(game.players).toEqual([]);
      expect(game.deck).toEqual([]);
      expect(game.buildingPiles).toEqual([[], [], [], []]);
      expect(game.currentPlayerIndex).toBe(0);
      expect(game.gameStarted).toBe(false);
      expect(game.gameOver).toBe(false);
      expect(game.winner).toBe(null);
    });
  });

  describe('createDeck', () => {
    it('creates 162 cards total', () => {
      const deck = game.createDeck();
      expect(deck).toHaveLength(162);
    });

    it('contains 12 copies of each number 1-12', () => {
      const deck = game.createDeck();
      for (let num = 1; num <= 12; num++) {
        const count = deck.filter((c) => c === num).length;
        expect(count).toBe(12);
      }
    });

    it('contains 18 SKIP-BO cards', () => {
      const deck = game.createDeck();
      const skipBoCount = deck.filter((c) => c === 'SKIP-BO').length;
      expect(skipBoCount).toBe(18);
    });
  });

  describe('shuffleDeck', () => {
    it('returns same number of cards', () => {
      const deck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = game.shuffleDeck([...deck]);
      expect(shuffled).toHaveLength(deck.length);
    });

    it('contains the same cards after shuffle', () => {
      const deck = [1, 2, 3, 4, 5, 'SKIP-BO'];
      const shuffled = game.shuffleDeck([...deck]);
      expect(shuffled.sort()).toEqual(deck.sort());
    });
  });

  describe('addPlayer', () => {
    it('adds a player successfully', () => {
      const result = game.addPlayer('p1', 'Alice');
      expect(result).toBe(true);
      expect(game.players).toHaveLength(1);
      expect(game.players[0]).toEqual({
        id: 'p1',
        name: 'Alice',
        stockpile: [],
        hand: [],
        discardPiles: [[], [], [], []],
      });
    });

    it('rejects when room is full', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      const result = game.addPlayer('p3', 'Charlie');
      expect(result).toBe(false);
      expect(game.players).toHaveLength(2);
    });

    it('allows up to maxPlayers', () => {
      const fourPlayerGame = new SkipBoGame('ROOM4', 4, null);
      expect(fourPlayerGame.addPlayer('p1', 'A')).toBe(true);
      expect(fourPlayerGame.addPlayer('p2', 'B')).toBe(true);
      expect(fourPlayerGame.addPlayer('p3', 'C')).toBe(true);
      expect(fourPlayerGame.addPlayer('p4', 'D')).toBe(true);
      expect(fourPlayerGame.addPlayer('p5', 'E')).toBe(false);
    });
  });

  describe('removePlayer', () => {
    it('removes an existing player', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      const result = game.removePlayer('p1');
      expect(result).toBe(true);
      expect(game.players).toHaveLength(1);
      expect(game.players[0].id).toBe('p2');
    });

    it('returns false for unknown player', () => {
      game.addPlayer('p1', 'Alice');
      const result = game.removePlayer('unknown');
      expect(result).toBe(false);
      expect(game.players).toHaveLength(1);
    });
  });

  describe('startGame', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
    });

    it('starts a game with 2 players', () => {
      const result = game.startGame();
      expect(result).toBe(true);
      expect(game.gameStarted).toBe(true);
      expect(game.currentPlayerIndex).toBe(0);
    });

    it('rejects with fewer than 2 players', () => {
      const soloGame = new SkipBoGame('SOLO', 2, null);
      soloGame.addPlayer('p1', 'Alone');
      expect(soloGame.startGame()).toBe(false);
      expect(soloGame.gameStarted).toBe(false);
    });

    it('rejects starting an already-started game', () => {
      game.startGame();
      expect(game.startGame()).toBe(false);
    });

    it('deals 30-card stockpiles for 2 players (default)', () => {
      game.startGame();
      expect(game.players[0].stockpile).toHaveLength(30);
      expect(game.players[1].stockpile).toHaveLength(30);
    });

    it('deals 5-card hands to each player', () => {
      game.startGame();
      expect(game.players[0].hand).toHaveLength(5);
      expect(game.players[1].hand).toHaveLength(5);
    });

    it('uses default 20-card stockpiles for 5+ players', () => {
      const bigGame = new SkipBoGame('BIG', 6, null);
      for (let i = 0; i < 6; i++) {
        bigGame.addPlayer(`p${i}`, `Player ${i}`);
      }
      bigGame.startGame();
      bigGame.players.forEach((p) => {
        expect(p.stockpile).toHaveLength(20);
      });
    });

    it('respects custom stockpile size', () => {
      const customGame = new SkipBoGame('CUSTOM', 2, 15);
      customGame.addPlayer('p1', 'Alice');
      customGame.addPlayer('p2', 'Bob');
      customGame.startGame();
      expect(customGame.players[0].stockpile).toHaveLength(15);
      expect(customGame.players[1].stockpile).toHaveLength(15);
    });

    it('caps stockpile size at max allowed', () => {
      const overGame = new SkipBoGame('OVER', 2, 50);
      overGame.addPlayer('p1', 'Alice');
      overGame.addPlayer('p2', 'Bob');
      overGame.startGame();
      // Max for ≤4 players is 30
      expect(overGame.players[0].stockpile).toHaveLength(30);
    });

    it('reduces deck size after dealing', () => {
      game.startGame();
      // 162 total - (2 players × 30 stockpile) - (2 players × 5 hand) = 92
      expect(game.deck).toHaveLength(92);
    });
  });
});
