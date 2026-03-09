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
 *
 * Behavior is controlled by feature flags (see presets.js). Different presets
 * toggle scoring components on/off to create distinct difficulty levels from
 * a single codebase.
 */

const { getNextCardValue } = require('./ChainDetector');
const { DIFFICULTY_PRESETS, DEFAULT_DIFFICULTY } = require('./presets');

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
 * When features.qualityAwareScoring is enabled (improved/advanced):
 *   Tier 1: Contiguous descending (top = card+1)     → +10
 *   Tier 2: Same value (top = card)                   → +7
 *   Tier 3: Empty pile                                → +5
 *   Tier 4: Adjacent gap descending (top = card+2..3) → +2..+3
 *   Tier 5: Large gap descending "bricking" (top > card+3) → -1..-3 (quality-scaled)
 *   Tier 6: Ascending (top < card)                    → -5-jump (quality-scaled)
 *
 * When features.qualityAwareScoring is disabled (baseline):
 *   Empty pile → +1, bricking → +1 (no negative penalties for large gaps)
 *
 * @param {number|string} card
 * @param {Array} pile
 * @param {number} [pileQuality] - chain quality of pile (higher = cleaner)
 * @param {Object} [features] - difficulty features (defaults to improved behavior)
 * @returns {number} score (higher = better)
 */
function discardPlacementScore(card, pile, pileQuality, features) {
  if (typeof card !== 'number') return 0; // SKIP-BO should never be discarded

  const qualityAware = !features || features.qualityAwareScoring !== false;

  if (pile.length === 0) return qualityAware ? 5 : 1;

  const top = pile[pile.length - 1];
  if (typeof top !== 'number') return 0;

  const diff = top - card;

  if (diff === 1) return 10; // Tier 1: contiguous descending — best
  if (diff === 0) return 7; // Tier 2: same value — good

  if (diff > 1) {
    if (diff <= 3) {
      // Tier 4: adjacent gap descending — decent
      return diff === 2 ? 3 : 2;
    }
    // Tier 5: large gap descending — bricking
    if (!qualityAware) return 1;
    const basePenalty = Math.max(-3, -(diff - 3));
    if (pileQuality != null) {
      const qualityMultiplier = Math.min(pileQuality, 4) / 4;
      return Math.round(basePenalty * (0.25 + 0.75 * qualityMultiplier));
    }
    return basePenalty;
  }

  // Tier 6: ascending — buries the current top
  const basePenalty = -5 - (card - top);
  if (!qualityAware) return basePenalty;
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

/**
 * Compute effective danger distance for a specific building pile need
 * relative to an opponent's stockpile value.
 *
 * Scans ALL cards in the opponent's discard piles (not just tops) plus
 * their stockpile top to determine how many UNKNOWN cards the opponent
 * would need to chain from pileNeed to their stockpile value.
 *
 * Example: piles need 6, opponent stock = 12, opponent discard has
 * [11, 10, 9, 8, 7] → gaps = 1 (only the 6 is missing).
 *
 * @param {number} pileNeed - what the building pile currently needs
 * @param {number} oppStock - opponent's stockpile top value
 * @param {Object} opponent - opponent player object with discardPiles
 * @returns {number} number of unknown cards needed (0 = opponent has everything)
 */
function effectiveDangerDist(pileNeed, oppStock, opponent) {
  if (pileNeed > oppStock) return Infinity; // already past their value

  // Collect ALL visible cards from opponent (full discard piles + stock top)
  const oppVisible = new Map(); // value → count
  for (const dp of opponent.discardPiles) {
    for (const card of dp) {
      if (card === 'SKIP-BO') {
        oppVisible.set('SKIP-BO', (oppVisible.get('SKIP-BO') || 0) + 1);
      } else if (typeof card === 'number') {
        oppVisible.set(card, (oppVisible.get(card) || 0) + 1);
      }
    }
  }

  // Count gaps: values in [pileNeed, oppStock-1] not covered by opponent's visible cards
  let gaps = 0;
  let skipBosAvailable = oppVisible.get('SKIP-BO') || 0;

  for (let v = pileNeed; v < oppStock; v++) {
    const available = oppVisible.get(v) || 0;
    if (available > 0) {
      // Opponent has this value visible — not a gap
      oppVisible.set(v, available - 1);
    } else if (skipBosAvailable > 0) {
      // Opponent can use a SKIP-BO as wild
      skipBosAvailable--;
    } else {
      gaps++;
    }
  }

  return gaps;
}

// ── Main evaluator ───────────────────────────────────────────────────

class StateEvaluator {
  /**
   * @param {CardCounter} cardCounter
   * @param {ChainDetector} chainDetector
   * @param {Object} [features] - difficulty features (defaults to improved preset)
   */
  constructor(cardCounter, chainDetector, features) {
    this.cc = cardCounter;
    this.cd = chainDetector;
    this.features = features || DIFFICULTY_PRESETS[DEFAULT_DIFFICULTY];
  }

  /**
   * Score a candidate play chain.
   *
   * @param {Object} chain - chain metadata from ChainDetector
   * @param {Object} playerState
   * @param {Object} gameState
   * @returns {number} score (higher = better)
   */
  scoreChain(chain, playerState, gameState) {
    let score = 0;

    // ── Stockpile progress (highest priority) ──
    score += chain.stockpilePlays * 100;

    // ── Chain length ──
    // Plays after the last stockpile play get reduced scoring unless
    // they contribute to hand cycling. This prevents the AI from
    // playing entire chains when only the stockpile-reaching portion
    // has strategic value.
    if (chain.stockpilePlays > 0 && chain.plays) {
      const lastStockIdx = chain.plays.reduce(
        (last, p, i) => (p.source === 'stockpile' ? i : last),
        -1
      );
      let playsBeforeAndIncluding = lastStockIdx + 1;
      let playsAfter = chain.totalPlays - playsBeforeAndIncluding;
      score += playsBeforeAndIncluding * 5;
      // Post-stockpile plays: full value only if they empty the hand
      score += playsAfter * (chain.handEmptied ? 5 : 2);
    } else {
      score += chain.totalPlays * 5;
    }
    if (this.features.qualityAwareScoring) {
      score += this._discardSourceBonus(chain, playerState);
    } else {
      score += chain.discardsRevealed * 3;
    }
    score += chain.pilesCompleted * 2;

    // ── Cycling value (hand empties → draw 5 fresh cards) ──
    if (chain.handEmptied) {
      score += this._cyclingValue(playerState, gameState);
    }

    // ── SKIP-BO cost ──
    // Base cost per SKIP-BO used. When no stockpile play results from the
    // chain, the cost is much steeper — using a wildcard without advancing
    // toward the win condition is almost always wasteful.
    if (chain.skipBosUsed > 0) {
      const perCard = chain.stockpilePlays > 0 ? 15 : 30;
      score -= chain.skipBosUsed * perCard;
    }

    // ── Opponent proximity penalty ──
    score += this._opponentImpact(chain, playerState, gameState);

    // ── Pile advancement toward own stockpile ──
    score += this._ownStockpileAdvancement(chain, playerState, gameState);

    // ── Stockpile-first ordering penalty (advanced only) ──
    if (this.features.stockpileOrderingPenalty) {
      score += this._stockpileOrderingPenalty(chain);
    }

    // ── Scarce card cost (§9 of strategy doc) ──
    if (this.features.scarceCardScoring) {
      for (const play of chain.plays) {
        if (play.source !== 'hand') continue;
        if (play.card === 'SKIP-BO') continue; // already penalized above
        if (typeof play.card !== 'number') continue;
        const remaining = this.cc.remaining(play.card);
        if (remaining <= 2) {
          score -= 5;
        } else if (remaining <= 4) {
          score -= 3;
        }
      }
    }

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

    if (this.features.qualityAwareScoring) {
      const quality = pileChainQuality(pile);
      const pileNeeds = gameState.buildingPiles.map((p) => getNextCardValue(p));

      let placementScore = discardPlacementScore(card, pile, quality, this.features);

      // Frozen pile discount: bricking a frozen pile costs less
      const frozen = isPileFrozen(pile, playerState.stockpileTop, pileNeeds);
      if (frozen && placementScore < 0) {
        placementScore = Math.round(placementScore * 0.4); // 60% discount
      }

      score += placementScore;
    } else {
      score += discardPlacementScore(card, pile, undefined, this.features);
    }

    // ── Hold value (inverted — lower hold value = better to discard) ──
    score -= this._holdValue(card, playerState, gameState);

    // ── Blocking bonus (discarding near opponent's stock = hiding it) ──
    score += this._blockingValue(card, gameState);

    // ── Runway preservation (cross-pile sequence planning) ──
    if (this.features.runwayDetection && runway && runway.length >= 3) {
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
      if (
        p.stockpileTop === playerState.stockpileTop &&
        p.stockpileCount === playerState.stockpileCount
      )
        continue; // skip self
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
   * Dispatches to simple (baseline) or advanced (improved/advanced) logic.
   */
  _opponentImpact(chain, playerState, gameState) {
    if (this.features.advancedOpponentPenalty) {
      return this._opponentImpactAdvanced(chain, playerState, gameState);
    }
    return this._opponentImpactSimple(chain, playerState, gameState);
  }

  /**
   * Baseline opponent impact: per-play penalties summed across opponents.
   * No danger zone analysis, no player count scaling.
   */
  _opponentImpactSimple(chain, playerState, gameState) {
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

  /**
   * Advanced opponent impact: final-state analysis with danger zones.
   *
   * Only penalizes the FINAL state of each pile after the chain completes,
   * not intermediate states. Uses worst single opponent penalty (not sum)
   * with player count scaling.
   */
  _opponentImpactAdvanced(chain, playerState, gameState) {
    // Player count scaling (§7.2): blocking matters less with more opponents
    const playerCount = gameState.players.length;
    const scaleFactor =
      playerCount <= 2 ? 1.0 : playerCount === 3 ? 0.6 : playerCount === 4 ? 0.4 : 0.2; // 5+

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

    // Track worst single opponent's penalty (not sum across all opponents)
    let worstPenalty = 0;

    for (const player of gameState.players) {
      if (
        player.stockpileCount === playerState.stockpileCount &&
        player.stockpileTop === playerState.stockpileTop
      )
        continue;

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

      let oppPenalty = 0;

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
          oppPenalty -= 50;
        } else if (distance === 1) {
          // Danger zone: opponent needs ONE card to reach stock
          const bridgeVal = finalNeed;
          const hasBridge = oppDiscardTops.has(bridgeVal) || oppDiscardTops.has('SKIP-BO');
          oppPenalty -= hasBridge ? 40 : 15;
        } else if (distance === 2) {
          let bridgesVisible = 0;
          for (let v = finalNeed; v < oppStock; v++) {
            if (oppDiscardTops.has(v) || oppDiscardTops.has('SKIP-BO')) bridgesVisible++;
          }
          oppPenalty -= bridgesVisible >= 2 ? 30 : 10;
        }
        // distance >= 3 or negative (past opponent stock): safe
      }

      if (oppPenalty < worstPenalty) {
        worstPenalty = oppPenalty;
      }
    }

    return Math.round(worstPenalty * scaleFactor);
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
   * Stockpile-first ordering penalty (§4.3 of strategy doc).
   *
   * Penalizes chains that play unrelated cards before the first stockpile play.
   * -7 per unrelated play (outweighs +5 per-play bonus).
   */
  _stockpileOrderingPenalty(chain) {
    if (chain.stockpilePlays === 0 || !chain.plays) return 0;

    const firstStockIdx = chain.plays.findIndex((p) => p.source === 'stockpile');
    if (firstStockIdx <= 0) return 0;

    const stockPileIndex = chain.plays[firstStockIdx].pileIndex;
    let penalty = 0;

    for (let i = 0; i < firstStockIdx; i++) {
      // Plays on the same building pile as the stockpile play are part of
      // advancing toward the stockpile — they're not "unrelated"
      if (chain.plays[i].pileIndex !== stockPileIndex) {
        penalty -= 7;
      }
    }

    return penalty;
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
      if (
        handNums[i + 1] === handNums[i] + 1 &&
        (handNums[i] === card || handNums[i + 1] === card)
      ) {
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
      bestFit = Math.max(bestFit, discardPlacementScore(card, pile, undefined, this.features));
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

      if (card === oppStock) bonus += 5; // hiding the value they need
      if (card === oppStock - 1) bonus += 3; // hiding the bridge to their value
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
  effectiveDangerDist,
};
