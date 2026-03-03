/**
 * ChainDetector — enumerates and scores all possible play sequences.
 *
 * A "chain" is an ordered sequence of card plays from the current state.
 * Each play modifies the state (pile advances, hand shrinks, discard top
 * changes), enabling new plays that weren't possible before.
 *
 * The detector explores all reachable play sequences via DFS and returns
 * them sorted by score.
 */

// ── Helpers (standalone, no dependency on gameLogic.js) ──────────────

function getNextCardValue(pileCards) {
  if (pileCards.length === 0) return 1;
  const last = pileCards[pileCards.length - 1];
  if (last === 'SKIP-BO') {
    let v = 0;
    for (const c of pileCards) {
      v = c === 'SKIP-BO' ? v + 1 : c;
    }
    return v === 12 ? null : v + 1;
  }
  return last === 12 ? null : last + 1;
}

function canPlayCard(card, nextValue) {
  if (nextValue == null) return false;
  return card === 'SKIP-BO' || card === nextValue;
}

// ── State snapshot for chain simulation ──────────────────────────────

/**
 * Lightweight mutable snapshot of the parts of game state that change
 * during chain simulation: hand, discard tops, building pile "next" values,
 * and stockpile top.
 */
function createSnapshot(playerState, gameState) {
  return {
    hand: [...playerState.hand],
    stockpileTop: playerState.stockpileTop,
    stockpileCount: playerState.stockpileCount,
    // Full discard piles (we need depth for reveal-on-play)
    discardPiles: playerState.discardPiles.map((p) => [...p]),
    // Building piles: just the "next needed" values (no need to copy full arrays)
    pileNeeds: gameState.buildingPiles.map((p) => getNextCardValue(p)),
    // Track pile card counts for completion detection
    pileLengths: gameState.buildingPiles.map((p) => p.length),
    deckCount: gameState.deckCount ?? 0,
  };
}

// ── Chain enumeration ────────────────────────────────────────────────

/**
 * Enumerate all possible plays from a snapshot.
 * Returns array of { card, source, pileIndex } objects.
 */
function enumeratePlays(snap) {
  const plays = [];

  for (let pi = 0; pi < 4; pi++) {
    const need = snap.pileNeeds[pi];
    if (need == null) continue;

    // Stockpile
    if (snap.stockpileTop != null && canPlayCard(snap.stockpileTop, need)) {
      plays.push({ card: snap.stockpileTop, source: 'stockpile', pileIndex: pi });
    }

    // Hand cards
    for (let hi = 0; hi < snap.hand.length; hi++) {
      if (canPlayCard(snap.hand[hi], need)) {
        plays.push({ card: snap.hand[hi], source: 'hand', pileIndex: pi, handIndex: hi });
      }
    }

    // Discard pile tops
    for (let di = 0; di < 4; di++) {
      const dpile = snap.discardPiles[di];
      if (dpile.length === 0) continue;
      const top = dpile[dpile.length - 1];
      if (canPlayCard(top, need)) {
        plays.push({ card: top, source: `discard${di}`, pileIndex: pi, discardIndex: di });
      }
    }
  }

  // Deduplicate: same card value from same source to same pile
  // (multiple hand cards of same value would create duplicates)
  const seen = new Set();
  return plays.filter((p) => {
    const key = `${p.card}|${p.source}|${p.pileIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Apply a play to a snapshot (mutates in place). Returns metadata about what happened.
 */
function applyPlay(snap, play) {
  const meta = {
    fromStockpile: play.source === 'stockpile',
    pileCompleted: false,
    handEmptied: false,
    cardRevealed: null,
  };

  // Remove card from source
  if (play.source === 'stockpile') {
    snap.stockpileTop = snap.stockpileCount > 1 ? undefined : null;
    // We don't know the next stockpile card — mark as undefined (unknown)
    // so we can detect "new stockpile revealed" vs "stockpile empty"
    snap.stockpileCount--;
    if (snap.stockpileCount <= 0) {
      snap.stockpileTop = null;
    }
  } else if (play.source === 'hand') {
    const idx = snap.hand.indexOf(play.card);
    if (idx !== -1) snap.hand.splice(idx, 1);
  } else if (play.source.startsWith('discard')) {
    const di = play.discardIndex;
    snap.discardPiles[di].pop();
    if (snap.discardPiles[di].length > 0) {
      meta.cardRevealed = snap.discardPiles[di][snap.discardPiles[di].length - 1];
    }
  }

  // Advance building pile
  const need = snap.pileNeeds[play.pileIndex];
  const actualValue = play.card === 'SKIP-BO' ? need : play.card;
  snap.pileLengths[play.pileIndex]++;

  if (actualValue === 12) {
    // Pile completes → resets
    snap.pileNeeds[play.pileIndex] = 1;
    snap.pileLengths[play.pileIndex] = 0;
    meta.pileCompleted = true;
  } else {
    snap.pileNeeds[play.pileIndex] = actualValue + 1;
  }

  // Hand empty → would auto-draw 5 (we can't simulate deck draws)
  if (snap.hand.length === 0) {
    meta.handEmptied = true;
  }

  return meta;
}

/**
 * Undo a play on a snapshot (restores previous state).
 */
function undoPlay(snap, play, prevPileNeed, prevPileLength, meta) {
  // Restore building pile
  snap.pileNeeds[play.pileIndex] = prevPileNeed;
  snap.pileLengths[play.pileIndex] = prevPileLength;

  // Restore source
  if (play.source === 'stockpile') {
    snap.stockpileTop = play.card;
    snap.stockpileCount++;
  } else if (play.source === 'hand') {
    snap.hand.push(play.card);
  } else if (play.source.startsWith('discard')) {
    snap.discardPiles[play.discardIndex].push(play.card);
  }
}

// ── Main chain search (DFS with backtracking) ───────────────────────

const MAX_CHAIN_DEPTH = 25; // safety limit

class ChainDetector {
  /**
   * Find all chains from the current state.
   *
   * Returns array of Chain objects, sorted by score (best first).
   * Each chain: { plays: [...], stockpilePlays, totalPlays, handEmptied,
   *               discardsRevealed, pilesCompleted }
   *
   * @param {Object} playerState
   * @param {Object} gameState
   * @param {Object} [options]
   * @param {number} [options.maxChains=100] - stop after finding this many chains
   * @param {boolean} [options.bestOnly=false] - only track the single best chain (fast)
   */
  findChains(playerState, gameState, options = {}) {
    const { maxChains = 100, bestOnly = false } = options;
    const snap = createSnapshot(playerState, gameState);
    const chains = [];
    const currentPlays = [];
    let best = null;

    const self = this;

    function dfs(depth) {
      if (depth > MAX_CHAIN_DEPTH) return;

      // Record current chain as a candidate (if non-empty)
      if (currentPlays.length > 0) {
        const chain = self._summarizeChain(currentPlays);
        if (bestOnly) {
          if (!best || chain.score > best.score) best = chain;
        } else {
          chains.push(chain);
          if (chains.length >= maxChains) return;
        }
      }

      // Stop exploring if hand emptied and deck has cards (would draw
      // unknown cards). When deck is empty the hand stays empty, so we
      // continue to find plays from stockpile and discards.
      if (snap.hand.length === 0 && snap.deckCount > 0) return;

      const plays = enumeratePlays(snap);
      for (const play of plays) {
        const prevNeed = snap.pileNeeds[play.pileIndex];
        const prevLen = snap.pileLengths[play.pileIndex];
        const meta = applyPlay(snap, play);

        currentPlays.push({ ...play, meta });
        dfs(depth + 1);
        currentPlays.pop();

        undoPlay(snap, play, prevNeed, prevLen, meta);

        if (!bestOnly && chains.length >= maxChains) return;
      }
    }

    dfs(0);

    if (bestOnly) return best ? [best] : [];

    // Sort by score descending
    chains.sort((a, b) => b.score - a.score);
    return chains;
  }

  /**
   * Find the single best chain (fastest — stops early).
   */
  findBestChain(playerState, gameState) {
    // Use full search but return just the top chain
    const chains = this.findChains(playerState, gameState, { maxChains: 200 });
    return chains[0] || null;
  }

  /**
   * Summarize a chain of plays into a scored result.
   */
  _summarizeChain(plays) {
    let stockpilePlays = 0;
    let handEmptied = false;
    let discardsRevealed = 0;
    let pilesCompleted = 0;
    let skipBosUsed = 0;

    const playsCopy = plays.map((p) => {
      if (p.meta.fromStockpile) stockpilePlays++;
      if (p.meta.handEmptied) handEmptied = true;
      if (p.meta.cardRevealed != null) discardsRevealed++;
      if (p.meta.pileCompleted) pilesCompleted++;
      if (p.card === 'SKIP-BO') skipBosUsed++;
      return {
        card: p.card,
        source: p.source,
        pileIndex: p.pileIndex,
      };
    });

    // Basic score (without opponent awareness — that's StateEvaluator's job)
    const score =
      stockpilePlays * 100 +
      playsCopy.length * 5 +
      discardsRevealed * 3 +
      pilesCompleted * 2 -
      skipBosUsed * 10;

    return {
      plays: playsCopy,
      score,
      stockpilePlays,
      totalPlays: playsCopy.length,
      handEmptied,
      discardsRevealed,
      pilesCompleted,
      skipBosUsed,
    };
  }
}

module.exports = { ChainDetector, getNextCardValue, canPlayCard };
