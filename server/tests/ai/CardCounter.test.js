const { CardCounter, CARD_TOTALS, TOTAL_CARDS } = require('../../ai/CardCounter');

// Helper to build minimal game/player states for testing
function makeState(overrides = {}) {
  const playerState = {
    hand: overrides.hand || [],
    stockpileTop: overrides.stockpileTop ?? null,
    stockpileCount: overrides.stockpileCount ?? 30,
    discardPiles: overrides.discardPiles || [[], [], [], []],
  };
  const gameState = {
    buildingPiles: overrides.buildingPiles || [[], [], [], []],
    deckCount: overrides.deckCount ?? 92,
    players: overrides.players || [
      { stockpileTop: overrides.stockpileTop ?? null, stockpileCount: 30, discardPiles: overrides.discardPiles || [[], [], [], []], handCount: (overrides.hand || []).length },
      { stockpileTop: overrides.oppStockTop ?? null, stockpileCount: 30, discardPiles: overrides.oppDiscards || [[], [], [], []], handCount: 5 },
    ],
  };
  return { playerState, gameState };
}

describe('CardCounter', () => {
  let cc;

  beforeEach(() => {
    cc = new CardCounter();
  });

  test('initial state: all cards unknown', () => {
    const { playerState, gameState } = makeState({ hand: [1, 2, 3, 4, 5], stockpileTop: 7 });
    cc.update(playerState, gameState);

    // 5 hand + 1 stock top + 1 opp stock (null) = 6 visible
    expect(cc.visible(1)).toBe(1);
    expect(cc.visible(7)).toBe(1); // own stock top
    expect(cc.remaining(1)).toBe(11);
    expect(cc.remaining(7)).toBe(11);
    expect(cc.remaining(6)).toBe(12); // unseen value
    expect(cc.unknownPool()).toBe(TOTAL_CARDS - 6);
  });

  test('counts building pile cards', () => {
    const { playerState, gameState } = makeState({
      hand: [5],
      buildingPiles: [[1, 2, 3], [1], [], []],
    });
    cc.update(playerState, gameState);

    expect(cc.visible(1)).toBe(2); // two 1s on building piles
    expect(cc.visible(2)).toBe(1);
    expect(cc.visible(3)).toBe(1);
    expect(cc.remaining(1)).toBe(10);
  });

  test('counts discard piles for all players', () => {
    const { playerState, gameState } = makeState({
      hand: [],
      discardPiles: [[10, 9], [], [], []],
      oppDiscards: [[8, 7], [6], [], []],
    });
    cc.update(playerState, gameState);

    expect(cc.visible(10)).toBe(1);
    expect(cc.visible(9)).toBe(1);
    expect(cc.visible(8)).toBe(1);
    expect(cc.visible(7)).toBe(1);
    expect(cc.visible(6)).toBe(1);
  });

  test('counts SKIP-BO cards', () => {
    const { playerState, gameState } = makeState({
      hand: ['SKIP-BO', 'SKIP-BO', 3],
      stockpileTop: 'SKIP-BO',
      buildingPiles: [['SKIP-BO'], [], [], []],
    });
    cc.update(playerState, gameState);

    // 2 in hand + 1 stock top + 1 building pile = 4
    expect(cc.visible('SKIP-BO')).toBe(4);
    expect(cc.remaining('SKIP-BO')).toBe(14);
  });

  test('remaining never goes negative', () => {
    // Pathological: more visible than total (shouldn't happen in real game)
    const cc2 = new CardCounter();
    cc2._visible = { 1: 15 };
    expect(cc2.remaining(1)).toBe(0);
  });

  test('deckSize returns gameState.deckCount', () => {
    const { playerState, gameState } = makeState({ deckCount: 55 });
    cc.update(playerState, gameState);
    expect(cc.deckSize()).toBe(55);
  });

  describe('pInDeck', () => {
    test('returns 0 for fully visible value', () => {
      const { playerState, gameState } = makeState({ hand: [1, 1, 1, 1, 1] });
      cc.update(playerState, gameState);
      // Only 5 of 12 ones visible, but let's test with all visible
      cc._visible = { 1: 12 };
      cc._unknownPool = 150;
      cc._deckCount = 90;
      expect(cc.pInDeck(1)).toBe(0);
    });

    test('returns > 0 for partially visible value', () => {
      const { playerState, gameState } = makeState({ hand: [1, 2, 3, 4, 5], deckCount: 90 });
      cc.update(playerState, gameState);
      const p = cc.pInDeck(1);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    });

    test('higher remaining → higher probability', () => {
      const { playerState, gameState } = makeState({ hand: [1, 1, 1, 2, 3], deckCount: 90 });
      cc.update(playerState, gameState);
      const p1 = cc.pInDeck(1); // 9 remaining
      const p2 = cc.pInDeck(2); // 11 remaining
      expect(p2).toBeGreaterThan(p1);
    });
  });

  describe('pDraw', () => {
    test('returns 0 for fully visible value', () => {
      cc._visible = { 1: 12 };
      cc._unknownPool = 150;
      cc._deckCount = 90;
      expect(cc.pDraw(1, 5)).toBe(0);
    });

    test('more draws → higher probability', () => {
      const { playerState, gameState } = makeState({ hand: [1, 2, 3, 4, 5], deckCount: 90 });
      cc.update(playerState, gameState);
      const p5 = cc.pDraw(6, 5);
      const p10 = cc.pDraw(6, 10);
      expect(p10).toBeGreaterThan(p5);
    });

    test('returns value between 0 and 1', () => {
      const { playerState, gameState } = makeState({ hand: [1, 2, 3, 4, 5], deckCount: 90 });
      cc.update(playerState, gameState);
      const p = cc.pDraw(7, 5);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });

    test('SKIP-BO has higher draw probability than numbered cards', () => {
      const { playerState, gameState } = makeState({ hand: [1, 2, 3, 4, 5], deckCount: 90 });
      cc.update(playerState, gameState);
      const pSkipBo = cc.pDraw('SKIP-BO', 5);
      const pNumber = cc.pDraw(6, 5); // 12 remaining vs 18 SKIP-BO
      expect(pSkipBo).toBeGreaterThan(pNumber);
    });
  });
});
