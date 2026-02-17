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
});
