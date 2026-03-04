/**
 * CardCounter — tracks visible cards and computes probabilities.
 *
 * Given the public game state + private player state, counts every visible
 * card and derives how many copies of each value remain in the unknown pool
 * (deck + opponent hands + all hidden stockpile cards).
 *
 * Deck composition: 12 copies of each value 1-12 (144) + 18 SKIP-BO = 162.
 */

const CARD_TOTALS = Object.freeze({
  1: 12,
  2: 12,
  3: 12,
  4: 12,
  5: 12,
  6: 12,
  7: 12,
  8: 12,
  9: 12,
  10: 12,
  11: 12,
  12: 12,
  'SKIP-BO': 18,
});

const TOTAL_CARDS = 162;

class CardCounter {
  constructor() {
    this._visible = {}; // value → count of visible copies
    this._unknownPool = 0; // total cards in unknown locations
    this._deckCount = 0;
  }

  /**
   * Recount all visible cards from the current game state.
   *
   * Visible cards live in:
   *   gameState: building piles, all players' discard piles, all stockpile tops
   *   playerState: own hand (only we can see card values)
   *
   * Unknown pool = deck + opponent hands + all hidden stockpile cards.
   *
   * @param {Object} playerState - { hand, stockpileTop, stockpileCount, discardPiles }
   * @param {Object} gameState   - { players[], buildingPiles[], deckCount }
   */
  update(playerState, gameState) {
    this._visible = {};
    this._deckCount = gameState.deckCount;

    // Building piles (fully visible to all)
    for (const pile of gameState.buildingPiles) {
      for (const card of pile) this._inc(card);
    }

    // All players' discard piles (fully visible) and stockpile tops
    for (const player of gameState.players) {
      for (const pile of player.discardPiles) {
        for (const card of pile) this._inc(card);
      }
      if (player.stockpileTop != null) {
        this._inc(player.stockpileTop);
      }
    }

    // Own hand (private — only we see card values)
    for (const card of playerState.hand) {
      this._inc(card);
    }

    // Unknown pool = total - visible
    const totalVisible = Object.values(this._visible).reduce((a, b) => a + b, 0);
    this._unknownPool = TOTAL_CARDS - totalVisible;
  }

  /** How many copies of value V are in known locations? */
  visible(value) {
    return this._visible[value] || 0;
  }

  /** How many copies of value V remain in the unknown pool? */
  remaining(value) {
    const total = CARD_TOTALS[value];
    if (total == null) return 0;
    return Math.max(0, total - this.visible(value));
  }

  /** Total cards in unknown locations. */
  unknownPool() {
    return this._unknownPool;
  }

  /** Deck size (from gameState.deckCount). */
  deckSize() {
    return this._deckCount;
  }

  /**
   * P(at least 1 copy of value V in the deck).
   *
   * Uses exact hypergeometric: P(X=0) = C(U-r, D) / C(U, D)
   * computed as product_{i=0}^{D-1} (U-r-i)/(U-i).
   *
   * r = remaining copies of V, U = unknown pool, D = deck size.
   */
  pInDeck(value) {
    const r = this.remaining(value);
    if (r <= 0) return 0;
    const U = this._unknownPool;
    const D = this._deckCount;
    if (U <= 0 || D <= 0) return 0;
    if (r >= U) return 1;

    let pNone = 1;
    for (let i = 0; i < D; i++) {
      const num = U - r - i;
      const den = U - i;
      if (num <= 0) return 1; // more remaining than non-deck slots
      pNone *= num / den;
    }
    return 1 - pNone;
  }

  /**
   * P(drawing at least 1 copy of value V in n draws from deck).
   *
   * We don't know the exact deck composition, so we estimate:
   *   expected copies of V in deck = r * D / U
   * then compute hypergeometric P(X=0) for drawing n from D with d copies.
   *
   * P(X=0) = product_{i=0}^{n-1} (D-d-i)/(D-i)
   */
  pDraw(value, n) {
    const r = this.remaining(value);
    if (r <= 0) return 0;
    const U = this._unknownPool;
    const D = this._deckCount;
    if (U <= 0 || D <= 0 || n <= 0) return 0;

    const d = (r * D) / U; // expected copies in deck
    const draws = Math.min(n, D);
    let pNone = 1;
    for (let i = 0; i < draws; i++) {
      const num = D - d - i;
      const den = D - i;
      if (num <= 0) return 1;
      if (den <= 0) return 0;
      pNone *= num / den;
    }
    return Math.max(0, Math.min(1, 1 - pNone));
  }

  /** @private */
  _inc(value) {
    this._visible[value] = (this._visible[value] || 0) + 1;
  }
}

module.exports = { CardCounter, CARD_TOTALS, TOTAL_CARDS };
