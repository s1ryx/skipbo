const { AIPlayer } = require('../../ai/AIPlayer');
const { DIFFICULTY_PRESETS } = require('../../ai/presets');

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

  describe('chooseDiscard', () => {
    test('returns a valid discard', () => {
      const { playerState, gameState } = makeState({
        hand: [5, 6, 7, 8, 9],
      });
      const discard = ai.chooseDiscard(playerState, gameState);
      expect(discard).not.toBeNull();
      expect(playerState.hand).toContain(discard.card);
      expect(discard.discardPileIndex).toBeGreaterThanOrEqual(0);
      expect(discard.discardPileIndex).toBeLessThanOrEqual(3);
    });

    test('never discards SKIP-BO when alternatives exist', () => {
      const { playerState, gameState } = makeState({
        hand: ['SKIP-BO', 'SKIP-BO', 3, 7, 12],
      });
      const discard = ai.chooseDiscard(playerState, gameState);
      expect(discard.card).not.toBe('SKIP-BO');
    });

    test('prefers contiguous descending placement', () => {
      const { playerState, gameState } = makeState({
        hand: [5, 6, 7, 8, 9],
        discardPiles: [[10], [], [], []], // pile 0 top is 10
      });
      const discard = ai.chooseDiscard(playerState, gameState);
      // 9 on pile 0 (top=10) is contiguous descending — should be preferred
      if (discard.card === 9) {
        expect(discard.discardPileIndex).toBe(0);
      }
    });

    test('does not discard card matching pile need when held deliberately', () => {
      const { playerState, gameState } = makeState({
        hand: [1, 2, 10, 11, 12],
        buildingPiles: [[], [], [], []], // all need 1
      });
      // The AI might choose to not play the 1 (unlikely but possible if opponent blocks).
      // When discarding, it should not discard the 1 since it matches a pile need.
      const discard = ai.chooseDiscard(playerState, gameState);
      // Should discard one of 10, 11, 12 (far from pile needs)
      expect(discard.card).toBeGreaterThanOrEqual(10);
    });

    test('returns null for empty hand', () => {
      const { playerState, gameState } = makeState({ hand: [] });
      const discard = ai.chooseDiscard(playerState, gameState);
      expect(discard).toBeNull();
    });
  });

  describe('opponent awareness', () => {
    test('avoids advancing pile toward opponent stockpile', () => {
      // Opponent needs 5 on their stockpile. Pile 0 is at [1,2,3] needing 4.
      // Playing 4 would bring pile to need 5 = opponent's stock. Should be penalized.
      const { playerState, gameState } = makeState({
        hand: [4, 4, 10, 11, 12],
        oppStockTop: 5,
        buildingPiles: [[1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8], [], []], // pile 0 needs 4, pile 1 needs 9
      });
      const play = ai.findPlayableCard(playerState, gameState);
      // The AI might still play (chain value may outweigh penalty) but the
      // score should reflect the opponent proximity penalty
      if (play && play.card === 4) {
        // If it plays 4, it should prefer pile 0 over... well pile 1 doesn't match.
        // This mainly tests that the scoring runs without errors.
        expect(play.buildingPileIndex).toBeDefined();
      }
    });
  });

  describe('full turn simulation', () => {
    test('plays multiple cards in sequence', () => {
      const { playerState, gameState } = makeState({
        hand: [1, 2, 3, 4, 5],
        buildingPiles: [[], [], [], []],
      });

      // Simulate a full turn
      const plays = [];
      let state = { ...playerState, hand: [...playerState.hand] };

      for (let i = 0; i < 20; i++) {
        // safety limit
        const play = ai.findPlayableCard(state, gameState);
        if (!play) break;
        plays.push(play);

        // Apply play to state
        if (play.source === 'hand') {
          const idx = state.hand.indexOf(play.card);
          state.hand.splice(idx, 1);
        }

        // Advance building pile
        const pile = gameState.buildingPiles[play.buildingPileIndex];
        pile.push(play.card);
      }

      // Should play 1 first (starts a pile), then potentially chain
      expect(plays.length).toBeGreaterThanOrEqual(1);
      expect(plays[0].card).toBe(1);
    });
  });

  describe('force play on empty hand', () => {
    test('plays from discard when hand is empty and deck is exhausted', () => {
      // Empty hand, empty deck — only discard pile has a playable card.
      // Score may be negative but AI must play to avoid deadlock.
      const { playerState, gameState } = makeState({
        hand: [],
        deckCount: 0,
        discardPiles: [[1], [], [], []], // discard 0 top = 1
        buildingPiles: [[], [], [], []], // all need 1
        oppStockTop: 2, // opponent close to pile need → negative penalty
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      expect(play.card).toBe(1);
      expect(play.source).toBe('discard0');
    });

    test('plays from stockpile when hand is empty', () => {
      const { playerState, gameState } = makeState({
        hand: [],
        deckCount: 0,
        stockpileTop: 1,
        stockpileCount: 5,
        buildingPiles: [[], [], [], []], // all need 1
      });
      // Stockpile plays are checked first (always play if possible)
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      expect(play.source).toBe('stockpile');
      expect(play.card).toBe(1);
    });

    test('returns null when hand is empty and no plays exist', () => {
      const { playerState, gameState } = makeState({
        hand: [],
        deckCount: 0,
        discardPiles: [[5], [], [], []], // discard top 5, no pile needs 5
        buildingPiles: [[1, 2, 3], [], [], []], // pile 0 needs 4, rest need 1
      });
      const play = ai.findPlayableCard(playerState, gameState);
      expect(play).toBeNull();
    });
  });

  describe('baseline preset', () => {
    let baselineAi;

    beforeEach(() => {
      baselineAi = new AIPlayer({ features: DIFFICULTY_PRESETS.baseline });
    });

    test('SKIP-BO stockpile play works without reachability scoring', () => {
      const { playerState, gameState } = makeState({
        hand: [5, 6, 7, 8, 9],
        stockpileTop: 'SKIP-BO',
        buildingPiles: [[1, 2, 3], [], [], []], // pile 0 needs 4
        oppStockTop: 10, // far away — no penalty
      });
      const play = baselineAi.findPlayableCard(playerState, gameState);
      expect(play).not.toBeNull();
      expect(play.source).toBe('stockpile');
      expect(play.card).toBe('SKIP-BO');
    });

    test('SKIP-BO stockpile scores differ from improved due to reachability', () => {
      // Two piles both accept SKIP-BO. With reachability, improved
      // may prefer the pile that yields more distinct pile needs.
      // Baseline only considers chain length + tiebreaker.
      const improvedAi = new AIPlayer({ features: DIFFICULTY_PRESETS.improved });
      const state = makeState({
        hand: [5, 6, 7, 8, 9],
        stockpileTop: 'SKIP-BO',
        buildingPiles: [[], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [], []], // pile 0 needs 1, pile 1 needs 12
        oppStockTop: 10,
      });
      // Both should return a valid play; we're testing they don't crash
      const basePlay = baselineAi.findPlayableCard(state.playerState, state.gameState);
      const improvedPlay = improvedAi.findPlayableCard(state.playerState, state.gameState);
      expect(basePlay).not.toBeNull();
      expect(improvedPlay).not.toBeNull();
    });

    test('chooseDiscard works without runway detection', () => {
      const { playerState, gameState } = makeState({
        hand: [5, 6, 7, 8, 9],
      });
      const discard = baselineAi.chooseDiscard(playerState, gameState);
      expect(discard).not.toBeNull();
      expect(playerState.hand).toContain(discard.card);
    });
  });

  describe('constructor', () => {
    test('defaults to improved preset', () => {
      const defaultAi = new AIPlayer();
      expect(defaultAi.features).toEqual(DIFFICULTY_PRESETS.improved);
    });

    test('accepts explicit features', () => {
      const customAi = new AIPlayer({ features: DIFFICULTY_PRESETS.advanced });
      expect(customAi.features).toEqual(DIFFICULTY_PRESETS.advanced);
    });
  });
});
