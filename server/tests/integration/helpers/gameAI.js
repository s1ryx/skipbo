/**
 * Game AI for integration tests and self-play scripts.
 * Supports competitive and cooperative play with optional verbose logging.
 *
 * Competitive: each player tries to empty their own stockpile.
 * Cooperative: all players collaborate to empty one target player's stockpile.
 */

const noop = () => {};

function getNextCardValue(pileCards) {
  if (pileCards.length === 0) return 1;
  const lastCard = pileCards[pileCards.length - 1];
  let lastValue;
  if (lastCard === 'SKIP-BO') {
    let value = 0;
    for (let i = 0; i < pileCards.length; i++) {
      if (pileCards[i] !== 'SKIP-BO') value = pileCards[i];
      else value++;
    }
    lastValue = value;
  } else {
    lastValue = lastCard;
  }
  return lastValue === 12 ? null : lastValue + 1;
}

function canPlayCard(card, nextValue) {
  if (nextValue === null) return false;
  if (card === 'SKIP-BO') return true;
  return card === nextValue;
}

function logState(playerState, gameState, log) {
  const nextValues = gameState.buildingPiles.map((pile) => getNextCardValue(pile));
  log(`  Piles need: [${nextValues.map((v) => v ?? 'done').join(', ')}]`);
  log(`  Hand: [${playerState.hand.join(', ')}]`);
  log(`  Stockpile: ${playerState.stockpileTop ?? 'empty'} (${playerState.stockpileCount} left)`);
}

/**
 * Find a playable card — competitive strategy.
 *
 * Core principle: the ONLY action that wins is emptying the stockpile.
 * Every play is evaluated by whether it helps play the stockpile.
 *
 * Phase 1: STOCKPILE — always play if possible (this wins the game)
 * Phase 2: HAND CARDS — prefer piles advancing toward stockpile value
 * Phase 3: DISCARD TOPS — only play if it enables a follow-up
 *          (pile completion is not special — resets to needing 1)
 * Phase 4: SKIP-BO — bridge toward stockpile value, then completion
 */
function findPlayableCard(playerState, gameState, log = noop) {
  const nextValues = gameState.buildingPiles.map((pile) => getNextCardValue(pile));
  const stockTop = playerState.stockpileTop;
  const stockNum = stockTop != null && stockTop !== 'SKIP-BO' ? stockTop : null;

  // Phase 1: Stockpile (always — this is the win condition)
  if (stockTop != null) {
    if (stockTop === 'SKIP-BO') {
      // SKIP-BO stockpile: play on pile closest to completion
      let bestPile = -1;
      let bestVal = -1;
      for (let i = 0; i < 4; i++) {
        if (nextValues[i] !== null && nextValues[i] > bestVal) {
          bestVal = nextValues[i];
          bestPile = i;
        }
      }
      if (bestPile !== -1) {
        log(
          `  >> STOCKPILE SKIP-BO -> pile ${bestPile} (as ${nextValues[bestPile]}, closest to completion)`
        );
        return { card: 'SKIP-BO', source: 'stockpile', buildingPileIndex: bestPile };
      }
    } else {
      for (let i = 0; i < 4; i++) {
        if (nextValues[i] === stockTop) {
          log(`  >> STOCKPILE ${stockTop} -> pile ${i}`);
          return { card: stockTop, source: 'stockpile', buildingPileIndex: i };
        }
      }
    }
  }

  // Phase 2: Hand cards — score by how much they advance toward stockpile
  {
    let bestCard = null;
    let bestPile = -1;
    let bestScore = -Infinity;

    for (const card of playerState.hand) {
      if (card === 'SKIP-BO') continue;
      for (let i = 0; i < 4; i++) {
        if (nextValues[i] !== card) continue;
        let score = 0;
        const nextAfter = card === 12 ? 1 : card + 1;
        // Huge bonus: playing this card makes the pile need our stockpile value
        if (stockNum != null && nextAfter === stockNum) score += 20;
        // Bonus: pile is below stockpile value and advancing toward it
        if (stockNum != null && card < stockNum) score += 10;
        // Tiebreaker: higher piles are closer to completion
        score += nextValues[i];
        if (score > bestScore) {
          bestScore = score;
          bestCard = card;
          bestPile = i;
        }
      }
    }

    if (bestCard !== null) {
      log(`  -> Hand ${bestCard} -> pile ${bestPile} (score ${bestScore})`);
      return { card: bestCard, source: 'hand', buildingPileIndex: bestPile };
    }
  }

  // Phase 3: Discard tops — only if it enables a follow-up play
  //   Pile completion (12 → reset) is NOT special: nextAfterPlay = 1
  for (let d = 0; d < 4; d++) {
    const pile = playerState.discardPiles[d];
    if (pile.length === 0) continue;
    const topCard = pile[pile.length - 1];
    for (let i = 0; i < 4; i++) {
      if (!canPlayCard(topCard, nextValues[i])) continue;
      // After playing this card, what does the pile need next?
      const nextAfterPlay = nextValues[i] === 12 ? 1 : nextValues[i] + 1;
      // Check if a follow-up play exists
      const handChains = playerState.hand.some((c) => canPlayCard(c, nextAfterPlay));
      const stockChains = stockTop != null && canPlayCard(stockTop, nextAfterPlay);
      const underChains = pile.length > 1 && canPlayCard(pile[pile.length - 2], nextAfterPlay);
      if (handChains || stockChains || underChains) {
        const reason = stockChains
          ? 'enables stockpile'
          : handChains
            ? 'enables hand card'
            : 'enables chain';
        log(`  -> Discard[${d}] ${topCard} -> pile ${i} (${reason})`);
        return { card: topCard, source: `discard${d}`, buildingPileIndex: i };
      }
      log(`  -- Skip discard[${d}] ${topCard} -> pile ${i} (no follow-up)`);
    }
  }

  // Phase 4: SKIP-BO from hand — bridge toward stockpile value
  if (playerState.hand.includes('SKIP-BO')) {
    let bestPile = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < 4; i++) {
      if (nextValues[i] === null) continue;
      let score = 0;
      const nextAfter = nextValues[i] === 12 ? 1 : nextValues[i] + 1;
      // Huge bonus: using SKIP-BO makes the pile need our stockpile value
      if (stockNum != null && nextAfter === stockNum) score += 20;
      // Bonus: pile is below stockpile value and advancing toward it
      if (stockNum != null && nextValues[i] < stockNum) score += 10;
      // Tiebreaker: closer to completion
      score += nextValues[i];
      if (score > bestScore) {
        bestScore = score;
        bestPile = i;
      }
    }

    if (bestPile !== -1) {
      log(`  -> Hand SKIP-BO -> pile ${bestPile} (as ${nextValues[bestPile]}, score ${bestScore})`);
      return { card: 'SKIP-BO', source: 'hand', buildingPileIndex: bestPile };
    }
  }

  log(`  -- No moves`);
  return null;
}

/**
 * Find a playable card — cooperative strategy.
 * All players collaborate to empty the target player's stockpile.
 *
 * Target player: uses the same competitive logic (findPlayableCard).
 *   Their goal is identical — empty their own stockpile.
 *
 * Helper players: cycle cards aggressively to advance building piles.
 *   1. Play hand/discard cards on any pile (except reserved piles)
 *   2. Reserve piles that need the target's stockpile value
 *   3. SKIP-BO bridges toward target's stockpile value
 *   4. Never play own stockpile (prevents accidental win)
 */
function findPlayableCardCooperative(
  playerState,
  gameState,
  targetPlayerId,
  isTargetPlayer,
  log = noop
) {
  const targetPlayer = gameState.players.find((p) => p.id === targetPlayerId);
  const targetTop = targetPlayer ? targetPlayer.stockpileTop : null;

  log(
    `  Target: ${targetPlayer?.name} stockpile=${targetTop} (${targetPlayer?.stockpileCount} left)`
  );

  // Target player: use competitive logic — same goal (empty own stockpile)
  if (isTargetPlayer) {
    return findPlayableCard(playerState, gameState, log);
  }

  // --- Helper player logic below ---
  const nextValues = gameState.buildingPiles.map((pile) => getNextCardValue(pile));
  const reservedValue = targetTop != null && targetTop !== 'SKIP-BO' ? targetTop : null;

  // 1. Play number cards from hand — cycle aggressively, skip reserved piles
  for (const card of playerState.hand) {
    if (card === 'SKIP-BO') continue;
    for (let i = 0; i < 4; i++) {
      if (nextValues[i] !== card) continue;
      if (nextValues[i] === reservedValue) {
        log(`  -- Skip pile ${i} (reserved for target's ${reservedValue})`);
        continue;
      }
      log(`  -> Hand ${card} -> pile ${i}`);
      return { card, source: 'hand', buildingPileIndex: i };
    }
  }

  // 2. Play discard pile tops — same reservation logic
  for (let d = 0; d < 4; d++) {
    const pile = playerState.discardPiles[d];
    if (pile.length === 0) continue;
    const topCard = pile[pile.length - 1];
    if (topCard === 'SKIP-BO') continue;
    for (let i = 0; i < 4; i++) {
      if (topCard !== nextValues[i]) continue;
      if (nextValues[i] === reservedValue) continue;
      log(`  -> Discard[${d}] ${topCard} -> pile ${i}`);
      return { card: topCard, source: `discard${d}`, buildingPileIndex: i };
    }
  }

  // 3. Never play own stockpile (prevents accidental win)

  // 4. SKIP-BO — prefer piles advancing toward target's stockpile value
  if (playerState.hand.includes('SKIP-BO')) {
    let bestPile = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < 4; i++) {
      if (nextValues[i] === null) continue;
      if (nextValues[i] === reservedValue) continue;
      let score = 0;
      const nextAfter = nextValues[i] === 12 ? 1 : nextValues[i] + 1;
      // Huge bonus: SKIP-BO makes the pile need target's stockpile value
      if (reservedValue != null && nextAfter === reservedValue) score += 20;
      // Bonus: pile is below target value and advancing toward it
      if (reservedValue != null && nextValues[i] < reservedValue) score += 10;
      // Tiebreaker: closer to completion
      score += nextValues[i];
      if (score > bestScore) {
        bestScore = score;
        bestPile = i;
      }
    }

    if (bestPile !== -1) {
      log(`  -> SKIP-BO -> pile ${bestPile} (as ${nextValues[bestPile]}, score ${bestScore})`);
      return { card: 'SKIP-BO', source: 'hand', buildingPileIndex: bestPile };
    }
  }

  log(`  -- No moves`);
  return null;
}

/**
 * Choose which discard pile to place a card on.
 * Uses all 4 piles with real strategies:
 *   1. Descending stack — top is card+1, enabling back-to-back play
 *   2. Same value — group identical values for bulk access
 *   3. Empty pile — start a new sequence
 *   4. Closest above — pile whose top is nearest value above the card
 *   5. Fewest cards — spread load across piles
 */
function pickDiscardPile(card, discardPiles, log = noop) {
  const cardNum = typeof card === 'number' ? card : null;

  // 1. Descending stack: top card is card+1 → play both back-to-back
  if (cardNum != null) {
    for (let d = 0; d < 4; d++) {
      const pile = discardPiles[d];
      if (pile.length > 0) {
        const top = pile[pile.length - 1];
        if (typeof top === 'number' && top === cardNum + 1) {
          log(`  Discard ${card} -> pile ${d} (descending under ${top})`);
          return d;
        }
      }
    }
  }

  // 2. Same value: group identical cards together
  if (cardNum != null) {
    for (let d = 0; d < 4; d++) {
      const pile = discardPiles[d];
      if (pile.length > 0) {
        const top = pile[pile.length - 1];
        if (top === cardNum) {
          log(`  Discard ${card} -> pile ${d} (grouping with ${top})`);
          return d;
        }
      }
    }
  }

  // 3. Empty pile: start a new sequence
  for (let d = 0; d < 4; d++) {
    if (discardPiles[d].length === 0) {
      log(`  Discard ${card} -> pile ${d} (empty)`);
      return d;
    }
  }

  // 4. Closest above: pile whose top is nearest value above the card
  //    This keeps piles roughly ordered for future descending plays
  if (cardNum != null) {
    let bestPile = -1;
    let bestGap = Infinity;
    for (let d = 0; d < 4; d++) {
      const pile = discardPiles[d];
      if (pile.length > 0) {
        const top = pile[pile.length - 1];
        if (typeof top === 'number' && top > cardNum) {
          const gap = top - cardNum;
          if (gap < bestGap) {
            bestGap = gap;
            bestPile = d;
          }
        }
      }
    }
    if (bestPile !== -1) {
      log(
        `  Discard ${card} -> pile ${bestPile} (closest above: ${discardPiles[bestPile][discardPiles[bestPile].length - 1]})`
      );
      return bestPile;
    }
  }

  // 5. Fewest cards: spread across piles
  let minLen = Infinity;
  let minPile = 0;
  for (let d = 0; d < 4; d++) {
    if (discardPiles[d].length < minLen) {
      minLen = discardPiles[d].length;
      minPile = d;
    }
  }
  log(`  Discard ${card} -> pile ${minPile} (fewest cards)`);
  return minPile;
}

/**
 * Choose discard — competitive strategy.
 * Discards highest non-SKIP-BO card using smart pile placement.
 */
function chooseDiscard(playerState, turnCount = 0, log = noop) {
  const hand = playerState.hand;
  if (hand.length === 0) return null;

  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < hand.length; i++) {
    const score = hand[i] === 'SKIP-BO' ? -1 : hand[i];
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const card = hand[bestIdx];
  const discardPileIndex = pickDiscardPile(card, playerState.discardPiles, log);
  return { card, discardPileIndex };
}

/**
 * Choose discard — cooperative strategy.
 * Discards highest non-SKIP-BO card using smart pile placement.
 * Never discards SKIP-BO.
 */
function chooseDiscardCooperative(
  playerState,
  gameState,
  targetPlayerId,
  turnCount = 0,
  log = noop
) {
  const hand = playerState.hand;
  if (hand.length === 0) return null;

  let bestCardIdx = -1;
  let bestCardValue = -1;
  for (let i = 0; i < hand.length; i++) {
    if (hand[i] === 'SKIP-BO') continue;
    if (hand[i] > bestCardValue) {
      bestCardValue = hand[i];
      bestCardIdx = i;
    }
  }
  if (bestCardIdx === -1) bestCardIdx = 0;
  const card = hand[bestCardIdx];

  const discardPileIndex = pickDiscardPile(card, playerState.discardPiles, log);
  return { card, discardPileIndex };
}

module.exports = {
  getNextCardValue,
  canPlayCard,
  logState,
  findPlayableCard,
  findPlayableCardCooperative,
  chooseDiscard,
  chooseDiscardCooperative,
};
