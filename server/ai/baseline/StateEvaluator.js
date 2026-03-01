/**
 * BASELINE StateEvaluator — pre-improvement version for comparison.
 *
 * This is the original evaluator before the 10 strategic improvements.
 * Differences from current version:
 *   - discardPlacementScore: empty pile = +1 (not +5), bricking = +1 (not negative)
 *   - No pileChainQuality (no sacrifice pile behavior)
 *   - No isPileFrozen (no frozen pile discount)
 *   - No detectRunway (no runway preservation)
 *   - scoreDiscard: no quality scaling, no frozen discount, no runway
 *   - scoreChain: flat discardsRevealed*3 (no structural repair bonus)
 *   - _opponentImpact: per-play penalties (not final-state), no danger zone, no player scaling
 */

const { getNextCardValue } = require('../ChainDetector');

function discardQuality(discardPiles) {
  let score = 0;
  for (const pile of discardPiles) {
    if (pile.length <= 1) continue;
    for (let i = pile.length - 1; i > 0; i--) {
      const top = pile[i];
      const below = pile[i - 1];
      if (typeof top !== 'number' || typeof below !== 'number') continue;
      if (below === top + 1) score += 3;
      else if (below > top) score += 1;
      else if (below === top) score += 2;
      else score -= 3;
    }
  }
  const tops = new Set();
  for (const pile of discardPiles) {
    if (pile.length > 0) {
      const top = pile[pile.length - 1];
      if (typeof top === 'number') tops.add(top);
    }
  }
  score += tops.size * 2;
  return score;
}

function discardPlacementScore(card, pile) {
  if (typeof card !== 'number') return 0;
  if (pile.length === 0) return 1; // empty pile — baseline was +1
  const top = pile[pile.length - 1];
  if (typeof top !== 'number') return 0;
  const diff = top - card;
  if (diff === 1) return 10;
  if (diff === 0) return 7;
  if (diff > 1) {
    if (diff <= 3) return diff === 2 ? 3 : 2;
    return 1; // bricking — baseline was +1
  }
  return -5 - (card - top); // ascending
}

function opponentDistances(gameState, opponentStockTop) {
  if (opponentStockTop == null || opponentStockTop === 'SKIP-BO') {
    return [null, null, null, null];
  }
  return gameState.buildingPiles.map((pile) => {
    const need = getNextCardValue(pile);
    if (need == null) return null;
    if (need > opponentStockTop) return null;
    return opponentStockTop - need;
  });
}

class StateEvaluator {
  constructor(cardCounter, chainDetector) {
    this.cc = cardCounter;
    this.cd = chainDetector;
  }

  scoreChain(chain, playerState, gameState) {
    let score = 0;
    score += chain.stockpilePlays * 100;
    score += chain.totalPlays * 5;
    score += chain.discardsRevealed * 3; // flat bonus — no structural repair
    score += chain.pilesCompleted * 2;
    if (chain.handEmptied) score += this._cyclingValue(playerState, gameState);
    score -= chain.skipBosUsed * 15;
    score += this._opponentImpact(chain, playerState, gameState);
    score += this._ownStockpileAdvancement(chain, playerState, gameState);
    return score;
  }

  scoreDiscard(card, pileIndex, playerState, gameState) {
    let score = 0;
    if (card === 'SKIP-BO') return -1000;
    const pile = playerState.discardPiles[pileIndex];
    // No quality scaling, no frozen discount, no runway
    score += discardPlacementScore(card, pile);
    score -= this._holdValue(card, playerState, gameState);
    score += this._blockingValue(card, gameState);
    return score;
  }

  evaluatePosition(playerState, gameState) {
    let score = 0;
    const initialStock = 30;
    const progress = (initialStock - playerState.stockpileCount) / initialStock;
    score += progress * 200;
    score += discardQuality(playerState.discardPiles);
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    let accessible = 0;
    for (const need of pileNeeds) {
      if (need == null) continue;
      if (playerState.hand.some((c) => c === need || c === 'SKIP-BO')) accessible++;
      for (const dp of playerState.discardPiles) {
        if (dp.length > 0 && (dp[dp.length - 1] === need || dp[dp.length - 1] === 'SKIP-BO'))
          accessible++;
      }
      if (playerState.stockpileTop === need || playerState.stockpileTop === 'SKIP-BO')
        accessible += 5;
    }
    score += accessible * 8;
    for (const p of gameState.players) {
      if (
        p.stockpileTop === playerState.stockpileTop &&
        p.stockpileCount === playerState.stockpileCount
      )
        continue;
      const oppProgress = (initialStock - p.stockpileCount) / initialStock;
      score -= oppProgress * 100;
    }
    return score;
  }

  _cyclingValue(playerState, gameState) {
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    let totalUsefulProb = 0;
    for (const need of pileNeeds) {
      if (need == null) continue;
      totalUsefulProb += this.cc.pDraw(need, 5);
    }
    totalUsefulProb += this.cc.pDraw('SKIP-BO', 5);
    return Math.min(totalUsefulProb, 2.0) * 15;
  }

  /**
   * BASELINE: per-play opponent penalties (not final-state).
   * No danger zone, no player count scaling.
   */
  _opponentImpact(chain, playerState, gameState) {
    let penalty = 0;
    for (const play of chain.plays) {
      for (const player of gameState.players) {
        if (
          player.stockpileCount === playerState.stockpileCount &&
          player.stockpileTop === playerState.stockpileTop
        )
          continue;
        const distances = opponentDistances(gameState, player.stockpileTop);
        const dist = distances[play.pileIndex];
        if (dist == null) continue;
        if (dist <= 0) penalty -= 20;
        else if (dist === 1) penalty -= 4;
        else if (dist === 2) penalty -= 1;
      }
    }
    return penalty;
  }

  _ownStockpileAdvancement(chain, playerState, gameState) {
    const ownStock = playerState.stockpileTop;
    if (ownStock == null || ownStock === 'SKIP-BO') return 0;
    let bonus = 0;
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    for (const play of chain.plays) {
      if (play.source === 'stockpile') continue;
      const need = pileNeeds[play.pileIndex];
      if (need == null) continue;
      const actualValue = play.card === 'SKIP-BO' ? need : play.card;
      if (actualValue < ownStock) {
        bonus += 3;
        if (actualValue === ownStock - 1) bonus += 10;
      }
      if (actualValue === 12) pileNeeds[play.pileIndex] = 1;
      else pileNeeds[play.pileIndex] = actualValue + 1;
    }
    return bonus;
  }

  _holdValue(card, playerState, gameState) {
    if (card === 'SKIP-BO') return 1000;
    let value = 0;
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    const ownStock = playerState.stockpileTop;
    for (const need of pileNeeds) {
      if (need === card) {
        value += 15;
        break;
      }
    }
    for (const need of pileNeeds) {
      if (need != null && card > need && card <= need + 2) {
        value += 8;
        break;
      }
    }
    if (typeof ownStock === 'number') {
      for (const need of pileNeeds) {
        if (need != null && card >= need && card <= ownStock) {
          value += 12;
          break;
        }
      }
    }
    const handNums = playerState.hand.filter((c) => typeof c === 'number').sort((a, b) => a - b);
    for (let i = 0; i < handNums.length - 1; i++) {
      if (
        handNums[i + 1] === handNums[i] + 1 &&
        (handNums[i] === card || handNums[i + 1] === card)
      ) {
        value += 6;
        break;
      }
    }
    const remaining = this.cc.remaining(card);
    if (remaining <= 2) value += 10;
    else if (remaining <= 4) value += 5;
    let bestFit = -Infinity;
    for (const pile of playerState.discardPiles) {
      bestFit = Math.max(bestFit, discardPlacementScore(card, pile));
    }
    value -= Math.max(0, bestFit) * 0.5;
    return value;
  }

  _blockingValue(card, gameState) {
    if (typeof card !== 'number') return 0;
    let bonus = 0;
    for (const player of gameState.players) {
      const oppStock = player.stockpileTop;
      if (oppStock == null || typeof oppStock !== 'number') continue;
      if (card === oppStock) bonus += 5;
      if (card === oppStock - 1) bonus += 3;
    }
    return bonus;
  }
}

module.exports = { StateEvaluator, discardQuality, discardPlacementScore };
