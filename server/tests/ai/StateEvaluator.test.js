const {
  StateEvaluator,
  discardQuality,
  discardPlacementScore,
  pileChainQuality,
  isPileFrozen,
  detectRunway,
} = require('../../ai/StateEvaluator');
const { CardCounter } = require('../../ai/CardCounter');
const { ChainDetector } = require('../../ai/ChainDetector');

// ── Test helpers ──────────────────────────────────────────────────────

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
        stockpileTop: overrides.oppStockTop ?? 10,
        stockpileCount: overrides.oppStockCount ?? 28,
        discardPiles: overrides.oppDiscards || [[], [], [], []],
        handCount: 5,
      },
    ],
  };
  return { playerState, gameState };
}

function makeEvaluator() {
  const cc = new CardCounter();
  const cd = new ChainDetector();
  return new StateEvaluator(cc, cd);
}

// ── pileChainQuality ──────────────────────────────────────────────────

describe('pileChainQuality', () => {
  test('empty pile = 0', () => {
    expect(pileChainQuality([])).toBe(0);
  });

  test('single card = 1', () => {
    expect(pileChainQuality([5])).toBe(1);
  });

  test('descending chain [8,7,6] = 3', () => {
    expect(pileChainQuality([8, 7, 6])).toBe(3);
  });

  test('same-value stacking [7,7,6] = 3', () => {
    // From top: 6, then 7 (7>=6 ✓), then 7 (7>=7 ✓) → quality 3
    expect(pileChainQuality([7, 7, 6])).toBe(3);
  });

  test('all same values [5,5,5] = 3', () => {
    expect(pileChainQuality([5, 5, 5])).toBe(3);
  });

  test('ascending break [5,9,6] = 1', () => {
    // From top: 6, then 9 (9>=6 ✓), then 5 (5<9 ✗) → quality 2
    // Wait: pile is [5,9,6]. top=6, below=9. 9>=6 ✓. below that=5. 5<9 ✗.
    expect(pileChainQuality([5, 9, 6])).toBe(2);
  });

  test('ascending at bottom only [3,8,7,6] = 3', () => {
    // From top: 6, then 7 (7>=6 ✓), then 8 (8>=7 ✓), then 3 (3<8 ✗) → quality 3
    expect(pileChainQuality([3, 8, 7, 6])).toBe(3);
  });

  test('multi-layer [8,7,7,6] = 4', () => {
    // From top: 6, 7 (>=6), 7 (>=7), 8 (>=7) → quality 4
    expect(pileChainQuality([8, 7, 7, 6])).toBe(4);
  });

  test('immediately blocked [3,2,5] = 1', () => {
    // From top: 5, then 2 (2<5 ✗) → quality 1
    expect(pileChainQuality([3, 2, 5])).toBe(1);
  });
});
