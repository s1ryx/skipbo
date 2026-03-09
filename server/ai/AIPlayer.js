/**
 * AIPlayer — orchestrates CardCounter, ChainDetector, and StateEvaluator
 * to make optimal play decisions.
 *
 * Implements the same interface as gameAI.js (findPlayableCard, chooseDiscard)
 * so it can be used as a drop-in replacement in self-play scripts.
 *
 * Difficulty is controlled by a features object (see presets.js). The
 * constructor defaults to the improved preset when no features are given.
 *
 * Decision flow per turn (see §3 of strategy doc):
 *   1. Update card counter with current state
 *   2. Find all possible chains (ChainDetector)
 *   3. Score each chain (StateEvaluator)
 *   4. Compare best chain score against "do nothing" (hold/stop)
 *   5. If best chain is +EV → return its first play
 *   6. If no chain is +EV → return null (triggers discard phase)
 */

const { CardCounter } = require('./CardCounter');
const { ChainDetector, getNextCardValue } = require('./ChainDetector');
const { StateEvaluator, detectRunway, effectiveDangerDist } = require('./StateEvaluator');
const { DIFFICULTY_PRESETS, DEFAULT_DIFFICULTY } = require('./presets');

const noop = () => {};

class AIPlayer {
  constructor(options = {}) {
    this.features = options.features || DIFFICULTY_PRESETS[DEFAULT_DIFFICULTY];
    this.cardCounter = new CardCounter();
    this.chainDetector = new ChainDetector();
    this.evaluator = new StateEvaluator(this.cardCounter, this.chainDetector, this.features);
    this.log = options.log || noop;
  }

  /**
   * Find the best card to play, or null if stopping is better.
   *
   * Compatible with gameAI.findPlayableCard interface:
   *   returns { card, source, buildingPileIndex } or null
   *
   * @param {Object} playerState - { hand, stockpileTop, stockpileCount, discardPiles }
   * @param {Object} gameState   - { players[], buildingPiles[], deckCount }
   * @param {Function} [log]     - optional logger
   */
  findPlayableCard(playerState, gameState, log) {
    const _log = log || this.log;

    // Update card counter with latest state
    this.cardCounter.update(playerState, gameState);

    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    _log(`  Piles need: [${pileNeeds.map((v) => v ?? 'done').join(', ')}]`);
    _log(`  Hand: [${playerState.hand.join(', ')}]`);
    _log(`  Stock: ${playerState.stockpileTop ?? 'empty'} (${playerState.stockpileCount} left)`);

    // ── DECISION 1: Stockpile play (always play if possible) ──

    const stockPlay = this._findStockpilePlay(playerState, gameState, pileNeeds, _log);
    if (stockPlay) return stockPlay;

    // ── DECISION 2-4: Find and evaluate all chains ──

    const chains = this.chainDetector.findChains(playerState, gameState, { maxChains: 200 });

    if (chains.length === 0) {
      _log('  -- No plays available');
      return null;
    }

    // Score each chain with full evaluation (opponent awareness, etc.)
    let bestChain = null;
    let bestScore = -Infinity;

    for (const chain of chains) {
      const score = this.evaluator.scoreChain(chain, playerState, gameState);
      if (score > bestScore) {
        bestScore = score;
        bestChain = chain;
      }
    }

    // ── DECISION 3: Should we play at all, or stop and discard? ──
    // "Do nothing" has value 0. Only play if best chain is positive.

    if (bestScore <= 0 || !bestChain) {
      // Force play on empty hand: can't discard with no cards, must play something
      if (bestChain && playerState.hand.length === 0) {
        const firstPlay = bestChain.plays[0];
        _log(
          `  >> FORCED (empty hand) ${firstPlay.source} ${firstPlay.card} -> pile ${firstPlay.pileIndex}`
        );
        return {
          card: firstPlay.card,
          source: firstPlay.source,
          buildingPileIndex: firstPlay.pileIndex,
        };
      }
      _log(`  -- Best chain score ${bestScore} ≤ 0, holding`);
      return null;
    }

    // Return the first play of the best chain
    const firstPlay = bestChain.plays[0];
    _log(
      `  >> ${firstPlay.source} ${firstPlay.card} -> pile ${firstPlay.pileIndex} (chain: ${bestChain.totalPlays} plays, score: ${bestScore})`
    );

    return {
      card: firstPlay.card,
      source: firstPlay.source,
      buildingPileIndex: firstPlay.pileIndex,
    };
  }

  /**
   * Choose which card to discard and on which pile.
   *
   * Compatible with gameAI.chooseDiscard interface:
   *   returns { card, discardPileIndex }
   *
   * @param {Object} playerState
   * @param {Object} gameState
   * @param {Function} [log]
   */
  chooseDiscard(playerState, gameState, log) {
    const _log = log || this.log;
    const hand = playerState.hand;

    if (hand.length === 0) return null;

    // Update card counter
    this.cardCounter.update(playerState, gameState);

    // Compute runway for cross-pile sequence planning (§11)
    const runway = this.features.runwayDetection
      ? detectRunway(playerState, gameState)
      : { length: 0, cards: [] };

    // Score every (card, pile) combination
    let bestCard = null;
    let bestPile = 0;
    let bestScore = -Infinity;

    for (let ci = 0; ci < hand.length; ci++) {
      const card = hand[ci];
      // Never discard SKIP-BO
      if (card === 'SKIP-BO') continue;

      for (let pi = 0; pi < 4; pi++) {
        const score = this.evaluator.scoreDiscard(card, pi, playerState, gameState, runway);
        if (score > bestScore) {
          bestScore = score;
          bestCard = card;
          bestPile = pi;
        }
      }
    }

    // Fallback: if all cards are SKIP-BO, discard the first one (shouldn't happen often)
    if (bestCard == null) {
      bestCard = hand[0];
      bestPile = this._fallbackDiscardPile(bestCard, playerState.discardPiles);
    }

    _log(`  Discard ${bestCard} -> pile ${bestPile} (score: ${bestScore})`);
    return { card: bestCard, discardPileIndex: bestPile };
  }

  // ── Private methods ────────────────────────────────────────────────

  /**
   * Find stockpile play — always play if possible.
   * For SKIP-BO stockpile: choose pile that maximizes chain potential.
   */
  _findStockpilePlay(playerState, gameState, pileNeeds, log) {
    const stockTop = playerState.stockpileTop;
    if (stockTop == null) return null;

    if (stockTop === 'SKIP-BO') {
      return this._findSkipBoStockpilePlay(playerState, gameState, pileNeeds, log);
    }

    // Numbered stockpile: find matching pile
    const matchingPiles = [];
    for (let i = 0; i < 4; i++) {
      if (pileNeeds[i] === stockTop) matchingPiles.push(i);
    }

    if (matchingPiles.length === 0) return null;

    if (matchingPiles.length === 1) {
      log(`  >> STOCK ${stockTop} -> pile ${matchingPiles[0]}`);
      return { card: stockTop, source: 'stockpile', buildingPileIndex: matchingPiles[0] };
    }

    // Multiple matching piles: pick the one least helpful to opponents
    let bestPile = matchingPiles[0];
    let bestScore = -Infinity;

    for (const pi of matchingPiles) {
      let score = 0;
      // Penalty for piles approaching opponent's stock value
      for (const player of gameState.players) {
        if (player.stockpileCount === playerState.stockpileCount) continue;
        const oppStock = player.stockpileTop;
        if (typeof oppStock === 'number') {
          const dist = oppStock - (stockTop + 1);
          if (dist >= 0 && dist <= 2) score -= (3 - dist) * 10;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestPile = pi;
      }
    }

    log(`  >> STOCK ${stockTop} -> pile ${bestPile}`);
    return { card: stockTop, source: 'stockpile', buildingPileIndex: bestPile };
  }

  /**
   * SKIP-BO from stockpile: evaluate each pile by chain potential.
   * Per §4.1: simulate placing on each pile, then check what chain follows.
   * With reachabilityScoring enabled, also considers next-stockpile reachability.
   */
  _findSkipBoStockpilePlay(playerState, gameState, pileNeeds, log) {
    let bestPile = -1;
    let bestScore = -Infinity;

    for (let pi = 0; pi < 4; pi++) {
      if (pileNeeds[pi] == null) continue;

      const nextAfter = pileNeeds[pi] === 12 ? 1 : pileNeeds[pi] + 1;
      let score = 0;

      // Check what chain we can play starting from nextAfter
      let chainLen = 0;
      let val = nextAfter;
      const usedHand = new Set();
      const usedDiscards = new Set();

      while (val >= 1 && val <= 12) {
        let found = false;

        // Check hand
        for (let hi = 0; hi < playerState.hand.length; hi++) {
          if (usedHand.has(hi)) continue;
          if (playerState.hand[hi] === val || playerState.hand[hi] === 'SKIP-BO') {
            usedHand.add(hi);
            chainLen++;
            found = true;
            break;
          }
        }
        if (!found) {
          // Check discard tops
          for (let di = 0; di < 4; di++) {
            if (usedDiscards.has(di)) continue;
            const dpile = playerState.discardPiles[di];
            if (dpile.length === 0) continue;
            if (dpile[dpile.length - 1] === val || dpile[dpile.length - 1] === 'SKIP-BO') {
              usedDiscards.add(di);
              chainLen++;
              found = true;
              break;
            }
          }
        }
        if (!found) break;
        val = val === 12 ? 1 : val + 1;
      }

      score += chainLen * 10;
      score += pileNeeds[pi]; // tiebreaker: higher piles closer to completion

      // ── Reachability scoring (§4.1 next-stockpile reachability) ──
      // For each value V (1-12), check if the player can chain from
      // hand + discard tops to reach V on any building pile after this
      // placement. Higher coverage = higher chance the next stockpile
      // card is immediately playable.
      if (this.features.reachabilityScoring) {
        const resultNeeds = [...pileNeeds];
        let endVal = pileNeeds[pi]; // SKIP-BO plays as this value
        resultNeeds[pi] = endVal === 12 ? 1 : endVal + 1;
        // Apply chain advancement
        let cv = resultNeeds[pi];
        for (let c = 0; c < chainLen; c++) {
          cv = cv === 12 ? 1 : cv + 1;
        }
        resultNeeds[pi] = cv;

        // Build available-cards map (value → count) from hand + discard tops
        const available = new Map();
        for (const card of playerState.hand) {
          if (card === 'SKIP-BO') continue; // SKIP-BO handled separately
          available.set(card, (available.get(card) || 0) + 1);
        }
        for (const dp of playerState.discardPiles) {
          if (dp.length === 0) continue;
          const top = dp[dp.length - 1];
          if (top === 'SKIP-BO') continue;
          available.set(top, (available.get(top) || 0) + 1);
        }

        // Walk forward from each pile's need, consuming available cards
        const reachable = new Set();
        for (let rpi = 0; rpi < 4; rpi++) {
          if (resultNeeds[rpi] == null) continue;
          reachable.add(resultNeeds[rpi]); // pile need itself is reachable
          const avail = new Map(available); // clone per pile
          let v = resultNeeds[rpi];
          // Walk: if v is available, the NEXT value (v+1) becomes reachable
          while (avail.get(v) > 0) {
            avail.set(v, avail.get(v) - 1);
            v = v === 12 ? 1 : v + 1;
            reachable.add(v);
          }
        }
        score += reachable.size * 3;
      }

      // Opponent penalty for SKIP-BO stockpile pile selection
      for (const player of gameState.players) {
        if (player.stockpileCount === playerState.stockpileCount) continue;
        const oppStock = player.stockpileTop;
        if (typeof oppStock !== 'number') continue;

        if (this.features.effectiveDangerDistance) {
          const gaps = effectiveDangerDist(nextAfter, oppStock, player);
          if (gaps <= 2) score -= 30;
        } else if (nextAfter <= oppStock && oppStock - nextAfter <= 2) {
          score -= 30;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestPile = pi;
      }
    }

    if (bestPile === -1) return null;

    log(
      `  >> STOCK SKIP-BO -> pile ${bestPile} (as ${pileNeeds[bestPile]}, chain score: ${bestScore})`
    );
    return { card: 'SKIP-BO', source: 'stockpile', buildingPileIndex: bestPile };
  }

  /**
   * Fallback discard pile selection (when forced to discard SKIP-BO).
   */
  _fallbackDiscardPile(card, discardPiles) {
    // Pick empty pile, or shortest pile
    for (let d = 0; d < 4; d++) {
      if (discardPiles[d].length === 0) return d;
    }
    let minLen = Infinity;
    let minPile = 0;
    for (let d = 0; d < 4; d++) {
      if (discardPiles[d].length < minLen) {
        minLen = discardPiles[d].length;
        minPile = d;
      }
    }
    return minPile;
  }
}

module.exports = { AIPlayer };
