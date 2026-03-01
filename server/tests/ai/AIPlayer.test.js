const { AIPlayer } = require('../../ai/AIPlayer');

function makeState(overrides = {}) {
  const playerState = {
    hand: overrides.hand || [5, 6, 7, 8, 9],
    stockpileTop: overrides.stockpileTop ?? null,
    stockpileCount: overrides.stockpileCount ?? 30,
    discardPiles: overrides.discardPiles || [[], [], [], []],
  };
  const gameState = {
    buildingPiles: overrides.buildingPiles || [[], [], [], []],
    deckCount: overrides.deckCount ?? 92,
    players: overrides.players || [
      {
        stockpileTop: playerState.stockpileTop,
        stockpileCount: playerState.stockpileCount,
        discardPiles: playerState.discardPiles,
        handCount: playerState.hand.length,
      },
      {
        stockpileTop: overrides.oppStockTop ?? 5,
        stockpileCount: overrides.oppStockCount ?? 28,
        discardPiles: overrides.oppDiscards || [[], [], [], []],
        handCount: 5,
      },
    ],
  };
  return { playerState, gameState };
}

describe('AIPlayer', () => {
  let ai;

  beforeEach(() => {
    ai = new AIPlayer();
  });

  describe('findPlayableCard', () => {
    test('plays stockpile when possible', () => {
      const { playerState, gameState } = makeState({
        hand: [5, 6, 7, 8, 9],
        stockpileTop: 1,
        buildingPiles: [[], [], [], []], // all need 1
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      expect(play.source).toBe('stockpile');
      expect(play.card).toBe(1);
    });

    test('plays SKIP-BO stockpile', () => {
      const { playerState, gameState } = makeState({
        hand: [5, 6, 7, 8, 9],
        stockpileTop: 'SKIP-BO',
        buildingPiles: [[1, 2, 3], [], [], []], // pile 0 needs 4
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      expect(play.source).toBe('stockpile');
      expect(play.card).toBe('SKIP-BO');
    });

    test('plays hand card when matching', () => {
      const { playerState, gameState } = makeState({
        hand: [3, 5, 6, 8, 9],
        oppStockTop: 10, // far from pile needs — no danger zone penalty
        buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      expect(play.card).toBe(3);
      expect(play.buildingPileIndex).toBe(0);
    });

    test('returns null when no plays available', () => {
      const { playerState, gameState } = makeState({
        hand: [5, 6, 7, 8, 9],
        buildingPiles: [[], [], [], []], // all need 1
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).toBeNull();
    });

    test('prefers chain that reaches stockpile', () => {
      const { playerState, gameState } = makeState({
        hand: [3, 4, 10, 11, 12],
        stockpileTop: 5,
        buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      // Should start the 3→4→stock(5) chain
      expect(play.card).toBe(3);
    });

    test('plays discard top when it enables chain', () => {
      const { playerState, gameState } = makeState({
        hand: [10, 11, 12, 8, 9],
        stockpileTop: 4,
        discardPiles: [[3], [], [], []],
        buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      // Should play 3 from discard to enable stockpile 4
      expect(play.card).toBe(3);
      expect(play.source).toBe('discard0');
    });
  });
});
