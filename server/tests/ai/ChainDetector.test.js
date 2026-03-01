const { ChainDetector, getNextCardValue, canPlayCard } = require('../../ai/ChainDetector');

function makeState(overrides = {}) {
  return {
    playerState: {
      hand: overrides.hand || [],
      stockpileTop: overrides.stockpileTop ?? null,
      stockpileCount: overrides.stockpileCount ?? 30,
      discardPiles: overrides.discardPiles || [[], [], [], []],
    },
    gameState: {
      buildingPiles: overrides.buildingPiles || [[], [], [], []],
      deckCount: overrides.deckCount ?? 92,
      players: overrides.players || [],
    },
  };
}

describe('getNextCardValue', () => {
  test('empty pile needs 1', () => {
    expect(getNextCardValue([])).toBe(1);
  });

  test('pile with numbers', () => {
    expect(getNextCardValue([1, 2, 3])).toBe(4);
    expect(getNextCardValue([1])).toBe(2);
  });

  test('pile at 12 is complete', () => {
    expect(getNextCardValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBeNull();
  });

  test('pile with SKIP-BO', () => {
    expect(getNextCardValue([1, 'SKIP-BO'])).toBe(3);
    expect(getNextCardValue(['SKIP-BO'])).toBe(2);
    expect(getNextCardValue([1, 2, 'SKIP-BO', 'SKIP-BO'])).toBe(5);
  });
});

describe('canPlayCard', () => {
  test('matching number can play', () => {
    expect(canPlayCard(3, 3)).toBe(true);
  });

  test('non-matching number cannot play', () => {
    expect(canPlayCard(4, 3)).toBe(false);
  });

  test('SKIP-BO can always play', () => {
    expect(canPlayCard('SKIP-BO', 5)).toBe(true);
  });

  test('nothing can play on null (complete pile)', () => {
    expect(canPlayCard(1, null)).toBe(false);
    expect(canPlayCard('SKIP-BO', null)).toBe(false);
  });
});
