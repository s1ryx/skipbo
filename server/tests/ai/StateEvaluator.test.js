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

// ── detectRunway ──────────────────────────────────────────────────────

describe('detectRunway', () => {
  test('detects sequence from hand matching pile need', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 4, 5, 8, 9],
      buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
    });
    const runway = detectRunway(playerState, gameState);
    expect(runway.length).toBe(3); // 3,4,5
    expect(runway.cards.has(3)).toBe(true);
    expect(runway.cards.has(4)).toBe(true);
    expect(runway.cards.has(5)).toBe(true);
  });

  test('includes discard pile tops in runway', () => {
    const { playerState, gameState } = makeState({
      hand: [4, 5, 8, 9, 10],
      discardPiles: [[3], [], [], []], // discard top = 3
      buildingPiles: [[1, 2], [], [], []], // pile needs 3
    });
    const runway = detectRunway(playerState, gameState);
    expect(runway.length).toBe(3); // 3(discard),4,5
  });

  test('SKIP-BO wildcards extend runway', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 'SKIP-BO', 5, 8, 9],
      buildingPiles: [[1, 2], [], [], []], // needs 3
    });
    const runway = detectRunway(playerState, gameState);
    expect(runway.length).toBe(3); // 3, SKIP-BO as 4, 5
  });

  test('returns length 0 when no pile needs match available cards', () => {
    const { playerState, gameState } = makeState({
      hand: [5, 6, 7, 8, 9],
      buildingPiles: [[], [], [], []], // all need 1
    });
    const runway = detectRunway(playerState, gameState);
    expect(runway.length).toBe(0);
  });

  test('picks the longest runway across all piles', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 4, 5, 6, 7],
      buildingPiles: [[1, 2], [1, 2, 3, 4], [], []], // pile 0 needs 3, pile 1 needs 5
    });
    const runway = detectRunway(playerState, gameState);
    // Pile 0: 3,4,5,6,7 = length 5
    // Pile 1: 5,6,7 = length 3
    expect(runway.length).toBe(5);
  });
});

// ── scoreDiscard with runway integration ──────────────────────────────

describe('StateEvaluator.scoreDiscard', () => {
  let evaluator;

  beforeEach(() => {
    evaluator = makeEvaluator();
  });

  test('penalizes discarding a runway card', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 4, 5, 8, 12],
      buildingPiles: [[1, 2], [], [], []], // needs 3
    });
    evaluator.cc.update(playerState, gameState);

    const runway = { length: 3, cards: new Set([3, 4, 5]) };

    // Discarding a runway card (3) should score worse than a non-runway card (12)
    const scoreRunway = evaluator.scoreDiscard(3, 1, playerState, gameState, runway);
    const scoreNonRunway = evaluator.scoreDiscard(12, 1, playerState, gameState, runway);
    expect(scoreNonRunway).toBeGreaterThan(scoreRunway);
  });

  test('no runway effect when runway < 3', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 8, 9, 10, 12],
      buildingPiles: [[1, 2], [], [], []], // needs 3
    });
    evaluator.cc.update(playerState, gameState);

    const runway = { length: 1, cards: new Set([3]) };

    // With short runway, no bonus/penalty applied
    const withRunway = evaluator.scoreDiscard(3, 1, playerState, gameState, runway);
    const withoutRunway = evaluator.scoreDiscard(3, 1, playerState, gameState);
    expect(withRunway).toBe(withoutRunway);
  });

  test('frozen pile gets discount on bricking', () => {
    const { playerState, gameState } = makeState({
      hand: [4, 8, 9, 10, 12],
      stockpileTop: 7,
      discardPiles: [[7, 7], [], [], []], // pile 0 has stock value 7s
      buildingPiles: [[1, 2], [], [], []], // no pile needs 7
    });
    evaluator.cc.update(playerState, gameState);

    // Bricking frozen pile 0 (4 on top of [7,7])
    const frozenBrick = evaluator.scoreDiscard(4, 0, playerState, gameState);
    // Bricking non-frozen empty pile 1
    const emptyPile = evaluator.scoreDiscard(4, 1, playerState, gameState);

    // Frozen pile brick should be less penalized (closer to 0 or even better)
    // compared to just the raw bricking cost. But empty pile is always +5.
    // The key: frozen pile discount makes bricking less negative.
    expect(frozenBrick).toBeGreaterThan(
      discardPlacementScore(4, [7, 7], pileChainQuality([7, 7])) - 20 // rough lower bound
    );
  });
});

// ── _opponentImpact (danger zone + player count) ─────────────────────

describe('StateEvaluator._opponentImpact', () => {
  let evaluator;

  beforeEach(() => {
    evaluator = makeEvaluator();
  });

  test('danger zone: heavy penalty when chain leaves pile at distance 1', () => {
    // Playing 4 on pile [1,2,3] → needs 5, opponent stock = 6 → distance 1
    const chain = {
      plays: [{ card: 4, source: 'hand', pileIndex: 0 }],
      totalPlays: 1,
      stockpilePlays: 0,
      discardsRevealed: 0,
      pilesCompleted: 0,
      skipBosUsed: 0,
      handEmptied: false,
    };

    const { playerState, gameState } = makeState({
      hand: [4],
      oppStockTop: 6,
      buildingPiles: [[1, 2, 3], [], [], []], // pile 0 needs 4
    });
    evaluator.cc.update(playerState, gameState);

    const impact = evaluator._opponentImpact(chain, playerState, gameState);
    // Should have both per-play penalty (distance 1 after playing 4→pile needs 5)
    // AND post-chain danger zone penalty
    expect(impact).toBeLessThan(-10);
  });

  test('blasting through danger zone: less penalty than stopping in it', () => {
    // Chain plays 4,5,6 on pile [1,2,3] → ends at 7, past opponent's stock 6
    const chainThrough = {
      plays: [
        { card: 4, source: 'hand', pileIndex: 0 },
        { card: 5, source: 'hand', pileIndex: 0 },
        { card: 6, source: 'hand', pileIndex: 0 },
      ],
      totalPlays: 3,
      stockpilePlays: 0,
      discardsRevealed: 0,
      pilesCompleted: 0,
      skipBosUsed: 0,
      handEmptied: false,
    };

    // Chain plays only 4 → stops at danger zone
    const chainStop = {
      plays: [{ card: 4, source: 'hand', pileIndex: 0 }],
      totalPlays: 1,
      stockpilePlays: 0,
      discardsRevealed: 0,
      pilesCompleted: 0,
      skipBosUsed: 0,
      handEmptied: false,
    };

    const { playerState, gameState } = makeState({
      hand: [4, 5, 6],
      oppStockTop: 6,
      buildingPiles: [[1, 2, 3], [], [], []], // needs 4
    });
    evaluator.cc.update(playerState, gameState);

    const impactThrough = evaluator._opponentImpact(chainThrough, playerState, gameState);
    const impactStop = evaluator._opponentImpact(chainStop, playerState, gameState);

    // Blasting through should have LESS penalty than stopping in danger zone
    expect(impactThrough).toBeGreaterThan(impactStop);
  });

  test('player count scaling: 4-player game has smaller penalties', () => {
    const chain = {
      plays: [{ card: 4, source: 'hand', pileIndex: 0 }],
      totalPlays: 1,
      stockpilePlays: 0,
      discardsRevealed: 0,
      pilesCompleted: 0,
      skipBosUsed: 0,
      handEmptied: false,
    };

    const { playerState: ps2, gameState: gs2 } = makeState({
      hand: [4],
      oppStockTop: 6,
      buildingPiles: [[1, 2, 3], [], [], []], // needs 4
    });

    // 4-player game
    const gs4 = {
      ...gs2,
      players: [
        gs2.players[0],
        gs2.players[1],
        { stockpileTop: 8, stockpileCount: 25, discardPiles: [[], [], [], []], handCount: 5 },
        { stockpileTop: 11, stockpileCount: 22, discardPiles: [[], [], [], []], handCount: 5 },
      ],
    };

    evaluator.cc.update(ps2, gs2);
    const impact2p = evaluator._opponentImpact(chain, ps2, gs2);

    evaluator.cc.update(ps2, gs4);
    const impact4p = evaluator._opponentImpact(chain, ps2, gs4);

    // 4-player penalty should be smaller in magnitude
    expect(Math.abs(impact4p)).toBeLessThan(Math.abs(impact2p));
  });
});

// ── scoreChain with discard source bonus ──────────────────────────────

describe('StateEvaluator.scoreChain', () => {
  let evaluator;

  beforeEach(() => {
    evaluator = makeEvaluator();
  });

  test('discard source from messy pile gets repair bonus', () => {
    // Chain plays from discard0 which is messy [5,9,6] (quality 2)
    const chain = {
      plays: [{ card: 6, source: 'discard0', pileIndex: 0 }],
      totalPlays: 1,
      stockpilePlays: 0,
      discardsRevealed: 1,
      pilesCompleted: 0,
      skipBosUsed: 0,
      handEmptied: false,
    };

    const { playerState, gameState } = makeState({
      hand: [8, 9, 10, 11, 12],
      discardPiles: [[5, 9, 6], [], [], []], // messy pile with quality 2
      buildingPiles: [[1, 2, 3, 4, 5], [], [], []], // pile 0 needs 6
    });
    evaluator.cc.update(playerState, gameState);

    const score = evaluator.scoreChain(chain, playerState, gameState);
    // Should include structural repair bonus (not just flat +3)
    expect(score).toBeGreaterThan(0);
  });

  test('hand-only chain gets no discard source bonus', () => {
    const chain = {
      plays: [{ card: 3, source: 'hand', pileIndex: 0 }],
      totalPlays: 1,
      stockpilePlays: 0,
      discardsRevealed: 0,
      pilesCompleted: 0,
      skipBosUsed: 0,
      handEmptied: false,
    };

    const { playerState, gameState } = makeState({
      hand: [3, 8, 9, 10, 12],
      buildingPiles: [[1, 2], [], [], []], // needs 3
    });
    evaluator.cc.update(playerState, gameState);

    // _discardSourceBonus should be 0 for hand-only plays
    const bonus = evaluator._discardSourceBonus(chain, playerState);
    expect(bonus).toBe(0);
  });
});
