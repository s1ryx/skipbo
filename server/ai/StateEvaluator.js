/**
 * StateEvaluator — scores game positions and candidate actions.
 *
 * Combines CardCounter (probability) and ChainDetector (chain analysis) to
 * produce a single numeric score for any candidate action. Handles opponent
 * awareness, discard pile quality, blocking, and cycling value.
 *
 * The evaluation is outcome-based (not strategy-based): it measures HOW CLOSE
 * a position is to winning, not whether a specific strategy pattern is followed.
 * This lets optimal strategies emerge from the search rather than being coded.
 */

const { getNextCardValue } = require('./ChainDetector');

// ── Discard pile quality metrics ─────────────────────────────────────

/**
 * Score the structural quality of a player's 4 discard piles.
 *
 * Good discard piles:
 * - Descending order within each pile (LIFO → FIFO for ascending build piles)
 * - Contiguous sequences (no gaps)
 * - Coverage across different value ranges
 *
 * Returns a score where higher = better structure.
 */
function discardQuality(discardPiles) {
  let score = 0;

  for (const pile of discardPiles) {
    if (pile.length <= 1) continue;

    for (let i = pile.length - 1; i > 0; i--) {
      const top = pile[i];
      const below = pile[i - 1];
      if (typeof top !== 'number' || typeof below !== 'number') continue;

      if (below === top + 1) {
        score += 3; // contiguous descending — perfect
      } else if (below > top) {
        score += 1; // descending with gap — ok
      } else if (below === top) {
        score += 2; // same value — good for blocking/dual play
      } else {
        score -= 3; // ascending — buried card
      }
    }
  }

  // Coverage bonus: how many distinct values are accessible (on pile tops)?
  const tops = new Set();
  for (const pile of discardPiles) {
    if (pile.length > 0) {
      const top = pile[pile.length - 1];
      if (typeof top === 'number') tops.add(top);
    }
  }
  score += tops.size * 2; // more distinct tops = more options

  return score;
}

/**
 * Score a specific discard placement: card C on pile P.
 *
 * Tier system (§4.7 of strategy doc):
 *   Tier 1: Contiguous descending (top = card+1)     → +10
 *   Tier 2: Same value (top = card)                   → +7
 *   Tier 3: Empty pile                                → +5
 *   Tier 4: Adjacent gap descending (top = card+2..3) → +2..+3
 *   Tier 5: Large gap descending "bricking" (top > card+3) → -1..-3
 *   Tier 6: Ascending (top < card)                    → -5-jump
 *
 * Optional pileQuality param (from pileChainQuality) scales bricking/ascending
 * penalties — bricking an already-bricked pile costs less.
 *
 * @param {number|string} card
 * @param {Array} pile
 * @param {number} [pileQuality] - chain quality of pile (higher = cleaner)
 * @returns {number} score (higher = better)
 */
function discardPlacementScore(card, pile, pileQuality) {
  if (typeof card !== 'number') return 0; // SKIP-BO should never be discarded

  if (pile.length === 0) return 5; // Tier 3: empty pile — safe, preserves structure

  const top = pile[pile.length - 1];
  if (typeof top !== 'number') return 0;

  const diff = top - card;

  if (diff === 1) return 10;  // Tier 1: contiguous descending — best
  if (diff === 0) return 7;   // Tier 2: same value — good

  if (diff > 1) {
    if (diff <= 3) {
      // Tier 4: adjacent gap descending — decent
      return diff === 2 ? 3 : 2;
    }
    // Tier 5: large gap descending — bricking
    const basePenalty = Math.max(-3, -(diff - 3));
    if (pileQuality != null) {
      const qualityMultiplier = Math.min(pileQuality, 4) / 4;
      return Math.round(basePenalty * (0.25 + 0.75 * qualityMultiplier));
    }
    return basePenalty;
  }

  // Tier 6: ascending — buries the current top
  const basePenalty = -5 - (card - top);
  if (pileQuality != null) {
    const qualityMultiplier = Math.min(pileQuality, 4) / 4;
    return Math.round(basePenalty * (0.25 + 0.75 * qualityMultiplier));
  }
  return basePenalty;
}

// ── Discard pile chain quality ───────────────────────────────────────

/**
 * Measure the chain quality of a discard pile — how many cards from the
 * top form an uninterrupted playable sequence (descending or same-value).
 *
 * Walk from top downward: chain continues while current card >= card above it
 * (same-value stacking and descending both count as playable chains).
 *
 * Examples:
 *   [7, 7, 6] → quality 3: play 6, then 7, then 7
 *   [5, 9, 6] → quality 1: only 6 playable, 9 blocks (ascending)
 *   [8, 7, 6] → quality 3: all descending
 *   []        → quality 0
 *
 * @param {Array} pile - discard pile (bottom to top, last element = top)
 * @returns {number} chain quality (0 = empty, higher = better)
 */
function pileChainQuality(pile) {
  if (pile.length === 0) return 0;

  let quality = 1; // top card is always accessible
  for (let i = pile.length - 2; i >= 0; i--) {
    const above = pile[i + 1]; // closer to top
    const current = pile[i];

    if (typeof above !== 'number' || typeof current !== 'number') break;

    // Chain continues if current >= above (descending or same-value)
    if (current >= above) {
      quality++;
    } else {
      break; // ascending = blocked
    }
  }

  return quality;
}

// ── Frozen pile detection ───────────────────────────────────────────

/**
 * Check if a discard pile is "frozen" — contains own stockpile value
 * that cannot yet be played on any building pile.
 *
 * A frozen pile's chain is blocked until building piles advance to the
 * stockpile value, so bricking it costs less.
 *
 * @param {Array} pile - discard pile
 * @param {number|string|null} ownStockTop - player's stockpile top
 * @param {Array} pileNeeds - current building pile needs [v1, v2, v3, v4]
 * @returns {boolean}
 */
function isPileFrozen(pile, ownStockTop, pileNeeds) {
  if (typeof ownStockTop !== 'number') return false;

  for (let i = pile.length - 1; i >= 0; i--) {
    if (pile[i] === ownStockTop) {
      // Frozen if no building pile currently needs this value
      return !pileNeeds.some((need) => need === ownStockTop);
    }
  }
  return false;
}

// ── Cross-pile runway detection ─────────────────────────────────────

/**
 * Detect the "runway" — longest ascending sequence playable from
 * hand cards + discard pile tops, starting from any building pile's need.
 *
 * @param {Object} playerState
 * @param {Object} gameState
 * @returns {{ length: number, cards: Set<number> }}
 */
function detectRunway(playerState, gameState) {
  const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));

  // Collect available values: hand + discard tops
  const available = new Map();
  for (const c of playerState.hand) {
    if (typeof c === 'number') {
      available.set(c, (available.get(c) || 0) + 1);
    }
  }
  for (const dp of playerState.discardPiles) {
    if (dp.length > 0) {
      const top = dp[dp.length - 1];
      if (typeof top === 'number') {
        available.set(top, (available.get(top) || 0) + 1);
      }
    }
  }

  // Count SKIP-BO wildcards
  let skipBos = playerState.hand.filter((c) => c === 'SKIP-BO').length;
  for (const dp of playerState.discardPiles) {
    if (dp.length > 0 && dp[dp.length - 1] === 'SKIP-BO') skipBos++;
  }

  let bestLength = 0;
  let bestCards = new Set();

  for (const startNeed of pileNeeds) {
    if (startNeed == null) continue;

    let length = 0;
    const used = new Map();
    let wildcardsUsed = 0;
    const cards = new Set();
    let val = startNeed;

    while (val >= 1 && val <= 12) {
      const avail = (available.get(val) || 0) - (used.get(val) || 0);
      if (avail > 0) {
        used.set(val, (used.get(val) || 0) + 1);
        cards.add(val);
        length++;
      } else if (wildcardsUsed < skipBos) {
        wildcardsUsed++;
        cards.add(val);
        length++;
      } else {
        break;
      }
      val = val === 12 ? 1 : val + 1;
    }

    if (length > bestLength) {
      bestLength = length;
      bestCards = cards;
    }
  }

  return { length: bestLength, cards: bestCards };
}

// ── Opponent proximity analysis ──────────────────────────────────────

/**
 * For each building pile, how close is it to the opponent's stockpile value?
 * Returns an array of 4 distances (steps needed to reach opponent's stock).
 * null means the opponent's stock value is unknown or SKIP-BO.
 */
function opponentDistances(gameState, opponentStockTop) {
  if (opponentStockTop == null || opponentStockTop === 'SKIP-BO') {
    return [null, null, null, null];
  }
  return gameState.buildingPiles.map((pile) => {
    const need = getNextCardValue(pile);
    if (need == null) return null; // pile complete
    if (need > opponentStockTop) return null; // already past their value
    return opponentStockTop - need; // steps needed
  });
}

// ── Main evaluator ───────────────────────────────────────────────────

class StateEvaluator {
  /**
   * @param {CardCounter} cardCounter
   * @param {ChainDetector} chainDetector
   */
  constructor(cardCounter, chainDetector) {
    this.cc = cardCounter;
    this.cd = chainDetector;
  }

  /**
   * Score a candidate play action.
   *
   * @param {Object} play - { card, source, pileIndex } from ChainDetector
   * @param {Object} chain - the full chain this play starts (from ChainDetector)
   * @param {Object} playerState
   * @param {Object} gameState
   * @returns {number} score (higher = better)
   */
  scoreChain(chain, playerState, gameState) {
    let score = 0;

    // ── Stockpile progress (highest priority) ──
    score += chain.stockpilePlays * 100;

    // ── Chain length ──
    score += chain.totalPlays * 5;
    score += this._discardSourceBonus(chain, playerState); // replaces flat discardsRevealed*3
    score += chain.pilesCompleted * 2;

    // ── Cycling value (hand empties → draw 5 fresh cards) ──
    if (chain.handEmptied) {
      score += this._cyclingValue(playerState, gameState);
    }

    // ── SKIP-BO cost ──
    score -= chain.skipBosUsed * 15;

    // ── Opponent proximity penalty ──
    score += this._opponentImpact(chain, playerState, gameState);

    // ── Pile advancement toward own stockpile ──
    score += this._ownStockpileAdvancement(chain, playerState, gameState);

    return score;
  }

  /**
   * Score a discard action: which card to discard and where.
   *
   * @param {number|string} card - the card to discard
   * @param {number} pileIndex - which discard pile (0-3)
   * @param {Object} playerState
   * @param {Object} gameState
   * @param {{ length: number, cards: Set<number> }} [runway] - pre-computed runway
   * @returns {number} score (higher = better discard choice)
   */
  scoreDiscard(card, pileIndex, playerState, gameState, runway) {
    let score = 0;

    // Never discard SKIP-BO
    if (card === 'SKIP-BO') return -1000;

    const pile = playerState.discardPiles[pileIndex];
    const quality = pileChainQuality(pile);
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));

    // ── Placement quality (with sacrifice pile scaling via pileQuality) ──
    let placementScore = discardPlacementScore(card, pile, quality);

    // ── Frozen pile discount: bricking a frozen pile costs less ──
    const frozen = isPileFrozen(pile, playerState.stockpileTop, pileNeeds);
    if (frozen && placementScore < 0) {
      placementScore = Math.round(placementScore * 0.4); // 60% discount
    }

    score += placementScore;

    // ── Hold value (inverted — lower hold value = better to discard) ──
    score -= this._holdValue(card, playerState, gameState);

    // ── Blocking bonus (discarding near opponent's stock = hiding it) ──
    score += this._blockingValue(card, gameState);

    // ── Runway preservation (cross-pile sequence planning) ──
    if (runway && runway.length >= 3) {
      if (runway.cards.has(card)) {
        score -= 8; // breaking a multi-turn sequence
      } else {
        score += 3; // preserving the sequence
      }
    }

    return score;
  }

  /**
   * Evaluate the overall quality of a game position (no action, just state).
   *
   * Higher = better position for us.
   */
  evaluatePosition(playerState, gameState) {
    let score = 0;

    // Stockpile progress (primary objective)
    const initialStock = 30; // assumed 2-4 players
    const progress = (initialStock - playerState.stockpileCount) / initialStock;
    score += progress * 200;

    // Discard pile structure quality
    score += discardQuality(playerState.discardPiles);

    // Accessible cards (discard tops + hand that match pile needs)
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    let accessible = 0;
    for (const need of pileNeeds) {
      if (need == null) continue;
      if (playerState.hand.some((c) => c === need || c === 'SKIP-BO')) accessible++;
      for (const dp of playerState.discardPiles) {
        if (dp.length > 0 && (dp[dp.length - 1] === need || dp[dp.length - 1] === 'SKIP-BO')) {
          accessible++;
        }
      }
      if (playerState.stockpileTop === need || playerState.stockpileTop === 'SKIP-BO') {
        accessible += 5; // stockpile plays are extremely valuable
      }
    }
    score += accessible * 8;

    // Opponent position (negative if they're ahead)
    for (const p of gameState.players) {
      if (p.stockpileTop === playerState.stockpileTop &&
          p.stockpileCount === playerState.stockpileCount) continue; // skip self
      const oppProgress = (initialStock - p.stockpileCount) / initialStock;
      score -= oppProgress * 100;
    }

    return score;
  }

  // ── Private scoring components ─────────────────────────────────────

  /**
   * Estimated value of cycling (emptying hand to draw 5 fresh).
   * Based on how likely the draw is to yield useful cards.
   */
  _cyclingValue(playerState, gameState) {
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    let totalUsefulProb = 0;

    for (const need of pileNeeds) {
      if (need == null) continue;
      totalUsefulProb += this.cc.pDraw(need, 5);
    }
    // Also SKIP-BO draws are always useful
    totalUsefulProb += this.cc.pDraw('SKIP-BO', 5);

    // Cap at reasonable range, scale to score
    return Math.min(totalUsefulProb, 2.0) * 15;
  }

  /**
   * Penalty for advancing piles toward opponent's stockpile value.
   *
   * Only penalizes the FINAL state of each pile after the chain completes,
   * not intermediate states. The opponent can't act between our plays within
   * a single turn, so intermediate pile values are irrelevant — what matters
   * is where we LEAVE the piles (§7.2 danger zone principle).
   *
   * Includes:
   * - Final-state distance penalties with graduated scale
   * - Danger zone: extra penalty when opponent needs just ONE card
   * - Player count scaling: penalties scale down with more players (§7.2)
   */
  _opponentImpact(chain, playerState, gameState) {
    let penalty = 0;

    // Player count scaling (§7.2): blocking matters less with more opponents
    const playerCount = gameState.players.length;
    const scaleFactor = playerCount <= 2 ? 1.0
      : playerCount === 3 ? 0.6
        : playerCount === 4 ? 0.4
          : 0.2; // 5+

    // Compute initial pile needs
    const initialNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));

    // Compute FINAL pile needs after entire chain executes
    const finalNeeds = [...initialNeeds];
    for (const play of chain.plays) {
      const need = finalNeeds[play.pileIndex];
      if (need == null) continue;
      const actualValue = play.card === 'SKIP-BO' ? need : play.card;
      finalNeeds[play.pileIndex] = actualValue === 12 ? 1 : actualValue + 1;
    }

    for (const player of gameState.players) {
      // Skip self (rough match by stockpile count — imperfect but sufficient)
      if (player.stockpileCount === playerState.stockpileCount &&
          player.stockpileTop === playerState.stockpileTop) continue;

      const oppStock = player.stockpileTop;
      if (oppStock == null || oppStock === 'SKIP-BO') continue;

      // Collect values visible on opponent's discard pile tops
      const oppDiscardTops = new Set();
      for (const dp of player.discardPiles) {
        if (dp.length > 0) {
          const top = dp[dp.length - 1];
          if (typeof top === 'number') oppDiscardTops.add(top);
          if (top === 'SKIP-BO') oppDiscardTops.add('SKIP-BO');
        }
      }

      // ── Final-state penalty for each pile ──
      for (let pi = 0; pi < 4; pi++) {
        const finalNeed = finalNeeds[pi];
        const initialNeed = initialNeeds[pi];
        if (finalNeed == null) continue;
        // Only penalize piles that the chain actually advanced
        if (finalNeed === initialNeed) continue;

        const distance = oppStock - finalNeed;

        if (distance === 0) {
          // Blunder: opponent plays stock directly on their turn
          penalty -= 50 * scaleFactor;
        } else if (distance === 1) {
          // Danger zone: opponent needs ONE card to reach stock
          const bridgeVal = finalNeed;
          const hasBridge = oppDiscardTops.has(bridgeVal) || oppDiscardTops.has('SKIP-BO');
          penalty -= (hasBridge ? 40 : 15) * scaleFactor;
        } else if (distance === 2) {
          let bridgesVisible = 0;
          for (let v = finalNeed; v < oppStock; v++) {
            if (oppDiscardTops.has(v) || oppDiscardTops.has('SKIP-BO')) bridgesVisible++;
          }
          penalty -= (bridgesVisible >= 2 ? 12 : 1) * scaleFactor;
        }
        // distance >= 3 or negative (past opponent stock): safe
      }
    }

    return Math.round(penalty);
  }

  /**
   * Bonus for chain plays that advance piles toward our own stockpile value.
   */
  _ownStockpileAdvancement(chain, playerState, gameState) {
    const ownStock = playerState.stockpileTop;
    if (ownStock == null || ownStock === 'SKIP-BO') return 0;

    let bonus = 0;
    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));

    for (const play of chain.plays) {
      if (play.source === 'stockpile') continue; // already scored under stockpilePlays

      const need = pileNeeds[play.pileIndex];
      if (need == null) continue;

      const actualValue = play.card === 'SKIP-BO' ? need : play.card;

      if (actualValue < ownStock) {
        bonus += 3; // advancing toward our stock value
        if (actualValue === ownStock - 1) {
          bonus += 10; // next play could be our stockpile!
        }
      }

      if (actualValue === 12) {
        pileNeeds[play.pileIndex] = 1;
      } else {
        pileNeeds[play.pileIndex] = actualValue + 1;
      }
    }

    return bonus;
  }

  /**
   * How valuable is it to keep card C in hand (higher = don't discard)?
   */
  _holdValue(card, playerState, gameState) {
    if (card === 'SKIP-BO') return 1000;
    let value = 0;

    const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));
    const ownStock = playerState.stockpileTop;

    // Matches a current pile need
    for (const need of pileNeeds) {
      if (need === card) {
        value += 15; // playable right now (we chose not to — must be for a reason)
        break;
      }
    }

    // Close to a pile need (1-2 steps away)
    for (const need of pileNeeds) {
      if (need != null && card > need && card <= need + 2) {
        value += 8;
        break;
      }
    }

    // On the path between pile need and our stockpile value
    if (typeof ownStock === 'number') {
      for (const need of pileNeeds) {
        if (need != null && card >= need && card <= ownStock) {
          value += 12; // bridging card
          break;
        }
      }
    }

    // Part of a hand sequence
    const handNums = playerState.hand.filter((c) => typeof c === 'number').sort((a, b) => a - b);
    for (let i = 0; i < handNums.length - 1; i++) {
      if (handNums[i + 1] === handNums[i] + 1 && (handNums[i] === card || handNums[i + 1] === card)) {
        value += 6; // consecutive pair
        break;
      }
    }

    // Scarcity
    const remaining = this.cc.remaining(card);
    if (remaining <= 2) value += 10;
    else if (remaining <= 4) value += 5;

    // Fits a discard pile well (reduces cost of discarding)
    let bestFit = -Infinity;
    for (const pile of playerState.discardPiles) {
      bestFit = Math.max(bestFit, discardPlacementScore(card, pile));
    }
    // Good fit reduces hold value (easier to discard without damage)
    value -= Math.max(0, bestFit) * 0.5;

    return value;
  }

  /**
   * Bonus for discarding a card that blocks the opponent.
   * Hiding a card near opponent's stock value in your discard pile
   * removes it from building pile circulation.
   */
  _blockingValue(card, gameState) {
    if (typeof card !== 'number') return 0;
    let bonus = 0;

    for (const player of gameState.players) {
      const oppStock = player.stockpileTop;
      if (oppStock == null || typeof oppStock !== 'number') continue;

      if (card === oppStock) bonus += 5;      // hiding the value they need
      if (card === oppStock - 1) bonus += 3;  // hiding the bridge to their value
    }

    return bonus;
  }

  /**
   * Bonus for chain plays from discard piles, scaled by structural repair value.
   *
   * Replaces the flat `discardsRevealed * 3` bonus with quality-aware scoring:
   * - Prefers playing from messier piles (structural repair, §4.5)
   * - Scores reveals by their actual structural impact (§8.4)
   *
   * @param {Object} chain
   * @param {Object} playerState
   * @returns {number} bonus
   */
  _discardSourceBonus(chain, playerState) {
    let bonus = 0;

    for (const play of chain.plays) {
      if (!play.source.startsWith('discard')) continue;

      const di = parseInt(play.source.replace('discard', ''), 10);
      const pile = playerState.discardPiles[di];
      if (!pile || pile.length === 0) continue;

      const qualityBefore = pileChainQuality(pile);

      // Base bonus: messier piles benefit more from plays (structural repair)
      if (qualityBefore <= 1) {
        bonus += 1; // already messy — minimal repair value
      } else if (qualityBefore === 2) {
        bonus += 3; // moderate repair
      } else {
        bonus += 2; // clean pile — playing from it isn't repair
      }

      // Reveal bonus: how does removing the top card affect pile structure?
      if (pile.length > 1) {
        const revealed = pile[pile.length - 2]; // card underneath
        if (pile.length > 2) {
          const below = pile[pile.length - 3];
          if (typeof revealed === 'number' && typeof below === 'number') {
            // Reveal restores descending order → high bonus
            bonus += below >= revealed ? 4 : 1;
          } else {
            bonus += 2; // uncertain (SKIP-BO involved)
          }
        } else {
          bonus += 3; // pile goes from 2 cards to 1 — always an improvement
        }
      }
    }

    return bonus;
  }
}

module.exports = {
  StateEvaluator,
  discardQuality,
  discardPlacementScore,
  pileChainQuality,
  isPileFrozen,
  detectRunway,
};
