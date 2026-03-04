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

describe('ChainDetector', () => {
  let cd;

  beforeEach(() => {
    cd = new ChainDetector();
  });

  test('no plays available → empty chains', () => {
    const { playerState, gameState } = makeState({
      hand: [5, 6, 7, 8, 9],
      buildingPiles: [[], [], [], []], // all need 1
    });
    const chains = cd.findChains(playerState, gameState);
    expect(chains).toHaveLength(0);
  });

  test('single card play', () => {
    const { playerState, gameState } = makeState({
      hand: [1, 5, 6, 8, 9],
      buildingPiles: [[], [], [], []], // all need 1
    });
    const chains = cd.findChains(playerState, gameState);
    expect(chains.length).toBeGreaterThan(0);

    // Should find chains starting with playing 1 on any of the 4 piles
    const singlePlays = chains.filter((c) => c.totalPlays === 1);
    expect(singlePlays.length).toBeGreaterThanOrEqual(4); // 1 on pile 0,1,2,3
  });

  test('hand chain: 3 → 4 on same pile', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 4, 10, 11, 12],
      buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
    });
    const chains = cd.findChains(playerState, gameState);

    // Should find chain: play 3 → pile needs 4 → play 4
    const chain2 = chains.find(
      (c) => c.totalPlays === 2 && c.plays[0].card === 3 && c.plays[1].card === 4
    );
    expect(chain2).toBeDefined();
    expect(chain2.plays[0].pileIndex).toBe(0);
    expect(chain2.plays[1].pileIndex).toBe(0);
  });

  test('stockpile play detected', () => {
    const { playerState, gameState } = makeState({
      hand: [5, 6, 7, 8, 9],
      stockpileTop: 1,
      buildingPiles: [[], [], [], []], // need 1
    });
    const chains = cd.findChains(playerState, gameState);

    const stockChains = chains.filter((c) => c.stockpilePlays > 0);
    expect(stockChains.length).toBeGreaterThan(0);
  });

  test('discard pile play with reveal', () => {
    const { playerState, gameState } = makeState({
      hand: [10, 11, 12, 8, 9],
      discardPiles: [[5, 3], [], [], []], // top is 3, reveal 5
      buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
    });
    const chains = cd.findChains(playerState, gameState);

    // Should find chain: discard0 top (3) → pile 0, reveals 5
    const discardChain = chains.find((c) => c.plays[0].source === 'discard0');
    expect(discardChain).toBeDefined();
    expect(discardChain.discardsRevealed).toBeGreaterThanOrEqual(1);
  });

  test('chain through discard reveal', () => {
    const { playerState, gameState } = makeState({
      hand: [10, 11, 12, 8, 9],
      discardPiles: [[4, 3], [], [], []], // top is 3, reveals 4
      buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
    });
    const chains = cd.findChains(playerState, gameState);

    // Chain: play 3 from discard → reveals 4 → play 4 from discard
    const revealChain = chains.find(
      (c) =>
        c.totalPlays >= 2 &&
        c.plays[0].source === 'discard0' &&
        c.plays[0].card === 3 &&
        c.plays[1].source === 'discard0' &&
        c.plays[1].card === 4
    );
    expect(revealChain).toBeDefined();
  });

  test('SKIP-BO hand play', () => {
    const { playerState, gameState } = makeState({
      hand: ['SKIP-BO', 5, 6, 7, 8],
      buildingPiles: [[1, 2, 3], [], [], []], // pile 0 needs 4
    });
    const chains = cd.findChains(playerState, gameState);

    // SKIP-BO can play as 4 on pile 0, then 5 from hand
    const skipChain = chains.find(
      (c) => c.plays[0].card === 'SKIP-BO' && c.plays[0].pileIndex === 0 && c.totalPlays >= 2
    );
    expect(skipChain).toBeDefined();
  });

  test('long chain scores higher than short chain', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 4, 5, 6, 7],
      buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
    });
    const chains = cd.findChains(playerState, gameState);
    chains.sort((a, b) => b.score - a.score);

    // Longest chain (3→4→5→6→7) should score highest
    expect(chains[0].totalPlays).toBeGreaterThanOrEqual(4);
    expect(chains[0].score).toBeGreaterThan(chains[chains.length - 1].score);
  });

  test('findBestChain returns top chain', () => {
    const { playerState, gameState } = makeState({
      hand: [3, 4, 5, 10, 11],
      buildingPiles: [[1, 2], [], [], []], // pile 0 needs 3
    });
    const best = cd.findBestChain(playerState, gameState);
    expect(best).not.toBeNull();
    expect(best.plays[0].card).toBe(3);
  });

  test('hand emptying detected', () => {
    const { playerState, gameState } = makeState({
      hand: [1],
      buildingPiles: [[], [], [], []], // all need 1
    });
    const chains = cd.findChains(playerState, gameState);

    const emptyChain = chains.find((c) => c.handEmptied);
    expect(emptyChain).toBeDefined();
  });
});
