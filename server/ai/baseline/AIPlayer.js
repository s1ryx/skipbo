/**
 * BASELINE AIPlayer — pre-improvement version for comparison.
 *
 * Uses baseline StateEvaluator (no quality scaling, no frozen piles,
 * no runway detection, per-play opponent penalties).
 *
 * Differences from current AIPlayer:
 *   - No SKIP-BO reachability scoring in _findSkipBoStockpilePlay
 *   - No runway detection in chooseDiscard
 *   - Uses baseline StateEvaluator
 */

const { CardCounter } = require('../CardCounter');
const { ChainDetector, getNextCardValue, canPlayCard } = require('../ChainDetector');
const { StateEvaluator } = require('./StateEvaluator');

const noop = () => {};

class AIPlayer {
  constructor(options = {}) {
    this.cardCounter = new CardCounter();
    this.chainDetector = new ChainDetector();
    this.evaluator = new StateEvaluator(this.cardCounter, this.chainDetector);
    this.log = options.log || noop;
  }

  findPlayableCard(playerState, gameState, log) {
    const _log = log || this.log;
    this.cardCounter.update(playerState, gameState);
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));

    // Stockpile play (always play if possible)
    const stockPlay = this._findStockpilePlay(playerState, gameState, pileNeeds, _log);
    if (stockPlay) return stockPlay;

    // Find and evaluate all chains
    const chains = this.chainDetector.findChains(playerState, gameState, { maxChains: 200 });
    if (chains.length === 0) return null;

    let bestChain = null;
    let bestScore = -Infinity;
    for (const chain of chains) {
      const score = this.evaluator.scoreChain(chain, playerState, gameState);
      if (score > bestScore) {
        bestScore = score;
        bestChain = chain;
      }
    }

    if (bestScore <= 0 || !bestChain) return null;

    const firstPlay = bestChain.plays[0];
    return {
      card: firstPlay.card,
      source: firstPlay.source,
      buildingPileIndex: firstPlay.pileIndex,
    };
  }

  chooseDiscard(playerState, gameState, log) {
    const _log = log || this.log;
    const hand = playerState.hand;
    if (hand.length === 0) return null;
    this.cardCounter.update(playerState, gameState);

    // No runway detection in baseline
    let bestCard = null;
    let bestPile = 0;
    let bestScore = -Infinity;
    for (let ci = 0; ci < hand.length; ci++) {
      const card = hand[ci];
      if (card === 'SKIP-BO') continue;
      for (let pi = 0; pi < 4; pi++) {
        const score = this.evaluator.scoreDiscard(card, pi, playerState, gameState);
        if (score > bestScore) {
          bestScore = score;
          bestCard = card;
          bestPile = pi;
        }
      }
    }

    if (bestCard == null) {
      bestCard = hand[0];
      bestPile = this._fallbackDiscardPile(bestCard, playerState.discardPiles);
    }

    return { card: bestCard, discardPileIndex: bestPile };
  }

  _findStockpilePlay(playerState, gameState, pileNeeds, log) {
    const stockTop = playerState.stockpileTop;
    if (stockTop == null) return null;

    if (stockTop === 'SKIP-BO') {
      return this._findSkipBoStockpilePlay(playerState, gameState, pileNeeds, log);
    }

    const matchingPiles = [];
    for (let i = 0; i < 4; i++) {
      if (pileNeeds[i] === stockTop) matchingPiles.push(i);
    }
    if (matchingPiles.length === 0) return null;
    if (matchingPiles.length === 1) {
      return { card: stockTop, source: 'stockpile', buildingPileIndex: matchingPiles[0] };
    }

    let bestPile = matchingPiles[0];
    let bestScore = -Infinity;
    for (const pi of matchingPiles) {
      let score = 0;
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
    return { card: stockTop, source: 'stockpile', buildingPileIndex: bestPile };
  }

  /**
   * BASELINE: No reachability scoring — just chain length + opponent penalty.
   */
  _findSkipBoStockpilePlay(playerState, gameState, pileNeeds, log) {
    let bestPile = -1;
    let bestScore = -Infinity;

    for (let pi = 0; pi < 4; pi++) {
      if (pileNeeds[pi] == null) continue;
      const nextAfter = pileNeeds[pi] === 12 ? 1 : pileNeeds[pi] + 1;
      let score = 0;

      let chainLen = 0;
      let val = nextAfter;
      const usedHand = new Set();
      const usedDiscards = new Set();

      while (val >= 1 && val <= 12) {
        let found = false;
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
      score += pileNeeds[pi]; // tiebreaker

      // No reachability scoring in baseline

      // Opponent penalty
      for (const player of gameState.players) {
        if (player.stockpileCount === playerState.stockpileCount) continue;
        const oppStock = player.stockpileTop;
        if (typeof oppStock === 'number' && nextAfter <= oppStock && oppStock - nextAfter <= 2) {
          score -= 30;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestPile = pi;
      }
    }

    if (bestPile === -1) return null;
    return { card: 'SKIP-BO', source: 'stockpile', buildingPileIndex: bestPile };
  }

  _fallbackDiscardPile(card, discardPiles) {
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
