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

// ── discardPlacementScore (revised tiers) ─────────────────────────────

describe('discardPlacementScore', () => {
  test('Tier 1: contiguous descending = +10', () => {
    expect(discardPlacementScore(9, [10])).toBe(10);
    expect(discardPlacementScore(5, [6])).toBe(10);
  });

  test('Tier 2: same value = +7', () => {
    expect(discardPlacementScore(7, [7])).toBe(7);
  });

  test('Tier 3: empty pile = +5', () => {
    expect(discardPlacementScore(5, [])).toBe(5);
    expect(discardPlacementScore(12, [])).toBe(5);
  });

  test('Tier 4: adjacent gap descending = +2..+3', () => {
    expect(discardPlacementScore(5, [7])).toBe(3);  // gap 2
    expect(discardPlacementScore(5, [8])).toBe(2);  // gap 3
  });

  test('Tier 5: large gap descending (bricking) = negative', () => {
    const score = discardPlacementScore(2, [10]);
    expect(score).toBeLessThan(0);
    expect(score).toBeGreaterThanOrEqual(-3);
  });

  test('Tier 6: ascending = heavily negative', () => {
    const score = discardPlacementScore(8, [5]);
    expect(score).toBeLessThan(-5);
  });

  test('empty pile > bricking', () => {
    const emptyScore = discardPlacementScore(4, []);
    const brickScore = discardPlacementScore(4, [10]);
    expect(emptyScore).toBeGreaterThan(brickScore);
  });

  test('SKIP-BO returns 0', () => {
    expect(discardPlacementScore('SKIP-BO', [5])).toBe(0);
  });

  // Sacrifice pile scaling (Gap 3)
  test('bricking quality-1 pile costs less than quality-3 pile', () => {
    const lowQuality = discardPlacementScore(2, [10], 1);
    const highQuality = discardPlacementScore(2, [10], 3);
    // Both should be negative, but low quality should be closer to 0
    expect(lowQuality).toBeLessThan(0);
    expect(highQuality).toBeLessThan(0);
    expect(lowQuality).toBeGreaterThan(highQuality);
  });

  test('ascending on quality-1 pile costs less than quality-4 pile', () => {
    const lowQ = discardPlacementScore(8, [5], 1);
    const highQ = discardPlacementScore(8, [5], 4);
    expect(lowQ).toBeGreaterThan(highQ);
  });

  test('quality scaling does not affect positive placements', () => {
    // Contiguous descending should remain +10 regardless of quality
    expect(discardPlacementScore(9, [10], 1)).toBe(10);
    expect(discardPlacementScore(9, [10], 4)).toBe(10);
  });
});

// ── isPileFrozen ──────────────────────────────────────────────────────

describe('isPileFrozen', () => {
  test('frozen when stockpile value in pile and no pile needs it', () => {
    expect(isPileFrozen([7, 7], 7, [3, 5, 1, 2])).toBe(true);
  });

  test('not frozen when a building pile needs the value', () => {
    expect(isPileFrozen([7, 7], 7, [7, 5, 1, 2])).toBe(false);
  });

  test('not frozen when stockpile value not in pile', () => {
    expect(isPileFrozen([3, 5], 7, [3, 5, 1, 2])).toBe(false);
  });

  test('not frozen for non-numeric stockpile', () => {
    expect(isPileFrozen([7, 7], 'SKIP-BO', [3, 5, 1, 2])).toBe(false);
  });

  test('not frozen for null stockpile', () => {
    expect(isPileFrozen([7, 7], null, [3, 5, 1, 2])).toBe(false);
  });

  test('not frozen for empty pile', () => {
    expect(isPileFrozen([], 7, [3, 5, 1, 2])).toBe(false);
  });
});
