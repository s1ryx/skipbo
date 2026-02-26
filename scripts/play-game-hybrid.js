#!/usr/bin/env node

/**
 * Hybrid Self-Play Script
 *
 * Player 1 uses a Playwright browser (tests full UI),
 * Player 2 uses direct Socket.IO (lightweight).
 *
 * Prerequisites:
 *   - Server running: cd server && npm start
 *   - Client running: cd client && npm start
 *
 * Usage:
 *   node scripts/play-game-hybrid.js [--headed] [--stockpile N] [--verbose] [--cooperative]
 *
 * Modes:
 *   --cooperative  Both players collaborate to empty Alice's stockpile
 *   --verbose      Print AI decision-making for each turn
 */

const path = require('path');
const { firefox } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));
const { io } = require(path.join(__dirname, '..', 'server', 'node_modules', 'socket.io-client'));
const gameAI = require(path.join(__dirname, '..', 'server', 'tests', 'integration', 'helpers', 'gameAI'));

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const verbose = args.includes('--verbose') || args.includes('-v');
const cooperative = args.includes('--cooperative') || args.includes('--coop');
const stockpileSize = parseInt(args.find((_, i, a) => a[i - 1] === '--stockpile') || '5', 10);

const SERVER_URL = 'http://localhost:3001';
const CLIENT_URL = 'http://localhost:3000';
const TIMEOUT = 10000;

function log(...msg) {
  if (verbose) console.log(...msg);
}

function waitFor(socket, event, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for '${event}'`));
    }, timeout);
    function handler(data) {
      clearTimeout(timer);
      resolve(data);
    }
    socket.once(event, handler);
  });
}

// ─── Card reading helpers ───────────────────────────────────────────

async function getNextValues(page) {
  const piles = await page.$$('.building-pile');
  const values = [];
  for (const pile of piles) {
    // Read .next-card span directly to avoid card value text bleeding into the match
    const nextCard = await pile.$('.next-card');
    if (nextCard) {
      const text = await nextCard.textContent();
      const match = text.match(/(\d+)/);
      values.push(match ? parseInt(match[1], 10) : null);
    } else {
      const emptyText = await pile.$('.empty-pile-text');
      values.push(emptyText ? 1 : null);
    }
  }
  return values;
}

async function getCardValue(element) {
  const center = await element.$('.card-value-center');
  if (!center) return null;
  const text = await center.textContent();
  if (text.includes('SB')) return 'SKIP-BO';
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function getHandCards(page) {
  const cards = await page.$$('.hand-card');
  const values = [];
  for (const card of cards) {
    const value = await getCardValue(card);
    if (value !== null) values.push({ value, element: card });
  }
  return values;
}

async function getStockpileCard(page) {
  const el = await page.$('.stockpile-section .card-clickable');
  if (!el) return null;
  const value = await getCardValue(el);
  return value !== null ? { value, element: el } : null;
}

async function getDiscardTopCards(page) {
  const piles = await page.$$('.discard-pile');
  const cards = [];
  for (let i = 0; i < piles.length; i++) {
    const topCard = await piles[i].$('.top-card');
    if (!topCard) continue;
    const value = await getCardValue(topCard);
    if (value !== null) cards.push({ value, element: topCard });
  }
  return cards;
}

async function getOpponentStockpileTop(page) {
  const card = await page.$('.opponent-info .card-pile .card-value-center');
  if (!card) return null;
  const text = await card.textContent();
  if (text.includes('SB')) return 'SKIP-BO';
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function canPlay(val, next) {
  if (next === null) return false;
  return val === 'SKIP-BO' || val === next;
}

// ─── Click helper ───────────────────────────────────────────────────

async function tryPlayOnPile(page, cardElement, pileIndex) {
  await cardElement.click({ force: true });
  await page.waitForTimeout(200);
  const piles = await page.$$('.building-pile.clickable');
  if (piles[pileIndex]) {
    await piles[pileIndex].click({ force: true });
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

// ─── Browser competitive play ───────────────────────────────────────

async function browserPlayTurn(page) {
  let played = 0;
  let foundMove = true;

  while (foundMove) {
    foundMove = false;
    const nextValues = await getNextValues(page);
    const stock = await getStockpileCard(page);
    const hand = await getHandCards(page);
    const discardCards = await getDiscardTopCards(page);

    log(`    Piles: [${nextValues.map((v) => v ?? 'done').join(', ')}], Hand: [${hand.map((c) => c.value).join(', ')}], Stock: ${stock?.value ?? '-'}`);

    // 1. Stockpile
    if (stock) {
      for (let i = 0; i < nextValues.length; i++) {
        if (canPlay(stock.value, nextValues[i])) {
          log(`    >> STOCKPILE ${stock.value} -> pile ${i}`);
          if (await tryPlayOnPile(page, stock.element, i)) { played++; foundMove = true; break; }
        }
      }
      if (foundMove) continue;
    }

    // 2. Hand number cards
    for (const card of hand) {
      if (card.value === 'SKIP-BO') continue;
      for (let i = 0; i < nextValues.length; i++) {
        if (canPlay(card.value, nextValues[i])) {
          log(`    -> Hand ${card.value} -> pile ${i}`);
          if (await tryPlayOnPile(page, card.element, i)) { played++; foundMove = true; break; }
        }
      }
      if (foundMove) break;
    }
    if (foundMove) continue;

    // 3. Discard tops
    for (const card of discardCards) {
      for (let i = 0; i < nextValues.length; i++) {
        if (canPlay(card.value, nextValues[i])) {
          log(`    -> Discard ${card.value} -> pile ${i}`);
          if (await tryPlayOnPile(page, card.element, i)) { played++; foundMove = true; break; }
        }
      }
      if (foundMove) break;
    }
    if (foundMove) continue;

    // 4. SKIP-BO from hand
    for (const card of hand) {
      if (card.value !== 'SKIP-BO') continue;
      for (let i = 0; i < nextValues.length; i++) {
        if (canPlay(card.value, nextValues[i])) {
          log(`    -> SKIP-BO -> pile ${i} (as ${nextValues[i]})`);
          if (await tryPlayOnPile(page, card.element, i)) { played++; foundMove = true; break; }
        }
      }
      if (foundMove) break;
    }
  }

  return played;
}

// ─── Browser cooperative play ───────────────────────────────────────

async function browserPlayTurnCooperative(page, targetStockpileTop, isTargetPlayer) {
  let played = 0;
  let foundMove = true;

  while (foundMove) {
    foundMove = false;
    const nextValues = await getNextValues(page);
    const stock = await getStockpileCard(page);
    const hand = await getHandCards(page);
    const discardCards = await getDiscardTopCards(page);
    const targetTop = targetStockpileTop;
    const reservedValue = (targetTop != null && targetTop !== 'SKIP-BO') ? targetTop : null;

    log(`    Piles: [${nextValues.map((v) => v ?? 'done').join(', ')}], Hand: [${hand.map((c) => c.value).join(', ')}], Stock: ${stock?.value ?? '-'}`);
    log(`    Target stockpile: ${targetTop}, Role: ${isTargetPlayer ? 'TARGET' : 'HELPER'}`);

    // 1. Target: play own stockpile first (this wins the game)
    if (isTargetPlayer && stock) {
      if (stock.value === 'SKIP-BO') {
        for (let i = 0; i < nextValues.length; i++) {
          if (nextValues[i] !== null) {
            log(`    >> TARGET STOCKPILE SKIP-BO -> pile ${i} (as ${nextValues[i]})`);
            if (await tryPlayOnPile(page, stock.element, i)) { played++; foundMove = true; break; }
          }
        }
      } else {
        for (let i = 0; i < nextValues.length; i++) {
          if (canPlay(stock.value, nextValues[i])) {
            log(`    >> TARGET STOCKPILE ${stock.value} -> pile ${i} (win progress!)`);
            if (await tryPlayOnPile(page, stock.element, i)) { played++; foundMove = true; break; }
          }
        }
      }
      if (foundMove) {
        const newStock = await getStockpileCard(page);
        targetStockpileTop = newStock ? newStock.value : null;
        continue;
      }
    }

    // 2. Play number cards from hand on any pile (cycle aggressively)
    //    Skip piles where nextValue === target's stockpile top (reserved for target)
    for (const card of hand) {
      if (card.value === 'SKIP-BO') continue;
      for (let i = 0; i < nextValues.length; i++) {
        if (nextValues[i] === null) continue;
        if (card.value !== nextValues[i]) continue;
        if (!isTargetPlayer && nextValues[i] === reservedValue) {
          log(`    -- Skip pile ${i} (reserved for target's ${reservedValue})`);
          continue;
        }
        log(`    -> Hand ${card.value} -> pile ${i}`);
        if (await tryPlayOnPile(page, card.element, i)) { played++; foundMove = true; break; }
      }
      if (foundMove) break;
    }
    if (foundMove) continue;

    // 3. Play discard pile tops on any pile (same reservation logic)
    for (const card of discardCards) {
      if (card.value === 'SKIP-BO') continue;
      for (let i = 0; i < nextValues.length; i++) {
        if (nextValues[i] === null) continue;
        if (card.value !== nextValues[i]) continue;
        if (!isTargetPlayer && nextValues[i] === reservedValue) continue;
        log(`    -> Discard ${card.value} -> pile ${i}`);
        if (await tryPlayOnPile(page, card.element, i)) { played++; foundMove = true; break; }
      }
      if (foundMove) break;
    }
    if (foundMove) continue;

    // 4. Non-target players do NOT play own stockpile (prevents accidental win)

    // 5. SKIP-BO — only to bridge to target's stockpile value
    if (reservedValue != null) {
      for (let i = 0; i < nextValues.length; i++) {
        if (nextValues[i] === null) continue;
        if (nextValues[i] === reservedValue - 1 || nextValues[i] === reservedValue) {
          const skipBo = hand.find((c) => c.value === 'SKIP-BO');
          if (skipBo) {
            log(`    -> SKIP-BO -> pile ${i} (as ${nextValues[i]}, bridging to target ${reservedValue})`);
            if (await tryPlayOnPile(page, skipBo.element, i)) { played++; foundMove = true; break; }
          }
        }
      }
      if (foundMove) continue;
    }

    // 6. SKIP-BO on any pile as last resort
    for (const card of hand) {
      if (card.value !== 'SKIP-BO') continue;
      for (let i = 0; i < nextValues.length; i++) {
        if (nextValues[i] === null) continue;
        if (!isTargetPlayer && nextValues[i] === reservedValue) continue;
        log(`    -> Last resort SKIP-BO -> pile ${i} (as ${nextValues[i]})`);
        if (await tryPlayOnPile(page, card.element, i)) { played++; foundMove = true; break; }
      }
      if (foundMove) break;
    }
  }

  return played;
}

// ─── Browser discard ────────────────────────────────────────────────

async function browserDiscard(page) {
  const btn = await page.$('button.btn-end-turn');
  if (btn) { await btn.click({ force: true }); await page.waitForTimeout(300); }

  const hand = await getHandCards(page);
  if (hand.length === 0) return;

  // Pick highest non-SKIP-BO card to discard
  const nonSkipBo = hand.filter((c) => c.value !== 'SKIP-BO');
  const cardToDiscard = nonSkipBo.length > 0
    ? nonSkipBo.sort((a, b) => b.value - a.value)[0]
    : hand[0];
  log(`    Discard ${cardToDiscard.value}`);
  await cardToDiscard.element.click({ force: true });
  await page.waitForTimeout(200);

  // Smart discard pile selection (matches gameAI.js pickDiscardPile logic)
  const piles = await page.$$('.discard-pile');
  if (piles.length === 0) return;

  const tops = [];
  for (let d = 0; d < piles.length; d++) {
    const topCard = await piles[d].$('.top-card');
    if (topCard) {
      tops.push(await getCardValue(topCard));
    } else {
      tops.push(null);
    }
  }

  const cardNum = typeof cardToDiscard.value === 'number' ? cardToDiscard.value : null;
  let bestPile = -1;

  // 1. Descending stack: top is card+1
  if (cardNum != null) {
    for (let d = 0; d < tops.length; d++) {
      if (typeof tops[d] === 'number' && tops[d] === cardNum + 1) {
        log(`    -> pile ${d} (descending under ${tops[d]})`);
        bestPile = d;
        break;
      }
    }
  }

  // 2. Same value grouping
  if (cardNum != null && bestPile === -1) {
    for (let d = 0; d < tops.length; d++) {
      if (tops[d] === cardNum) {
        log(`    -> pile ${d} (grouping with ${tops[d]})`);
        bestPile = d;
        break;
      }
    }
  }

  // 3. Empty pile
  if (bestPile === -1) {
    for (let d = 0; d < tops.length; d++) {
      if (tops[d] === null) {
        log(`    -> pile ${d} (empty)`);
        bestPile = d;
        break;
      }
    }
  }

  // 4. Closest above
  if (cardNum != null && bestPile === -1) {
    let bestGap = Infinity;
    for (let d = 0; d < tops.length; d++) {
      if (typeof tops[d] === 'number' && tops[d] > cardNum) {
        const gap = tops[d] - cardNum;
        if (gap < bestGap) { bestGap = gap; bestPile = d; }
      }
    }
    if (bestPile !== -1) log(`    -> pile ${bestPile} (closest above ${tops[bestPile]})`);
  }

  // 5. Fallback: first pile
  if (bestPile === -1) {
    bestPile = 0;
    log(`    -> pile 0 (fallback)`);
  }

  await piles[bestPile].click({ force: true });
  await page.waitForTimeout(500);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const mode = cooperative ? 'cooperative' : 'competitive';
  console.log(`\n=== Skip-Bo Hybrid Self-Play (${mode}) ===`);
  console.log(`Browser: Alice (heuristic), Socket.IO: Bob (heuristic)`);
  console.log(`Mode: ${headed ? 'headed' : 'headless'}, Stockpile: ${stockpileSize}\n`);

  const browser = await firefox.launch({ headless: !headed });

  // Socket.IO player (Bob)
  const bobSocket = io(SERVER_URL, { forceNew: true, transports: ['websocket'] });
  await new Promise((resolve) => bobSocket.on('connect', resolve));
  console.log('Bob connected via Socket.IO');

  try {
    // Browser player (Alice): Create room
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Alice: Opening browser...');
    await page.goto(CLIENT_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[placeholder="Enter your name"]', 'Alice');

    const slider = await page.$('input.stockpile-slider');
    if (slider) {
      await slider.evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, stockpileSize);
    }

    await page.click('button:has-text("Create Room")');
    await page.waitForSelector('.waiting-room h2', { timeout: TIMEOUT });
    const roomHeader = await page.$eval('.waiting-room h2', (el) => el.textContent);
    const roomId = roomHeader.replace(/Room:\s*/i, '').trim();
    console.log(`Room created: ${roomId}`);

    // Bob joins via Socket.IO
    const bobTokenP = waitFor(bobSocket, 'sessionToken');
    bobSocket.emit('joinRoom', { roomId, playerName: 'Bob' });
    const bobToken = await bobTokenP;
    console.log('Bob joined room via Socket.IO');

    // Alice starts game
    await page.waitForSelector('button.btn-start-game', { timeout: TIMEOUT });
    const bobStartP = waitFor(bobSocket, 'gameStarted');
    await page.click('button:has-text("Start Game")');
    const bobStarted = await bobStartP;
    await page.waitForSelector('.game-board', { timeout: TIMEOUT });
    console.log('Game started!');

    // Bob's state tracking
    let bobPlayerState = bobStarted.playerState;
    let bobGameState = bobStarted.gameState;
    const bobId = bobToken.playerId;
    let stateUpdateResolve = null;

    // Find Alice's player ID for cooperative mode
    const alicePlayerId = bobGameState.players.find((p) => p.name === 'Alice')?.id;

    if (cooperative) {
      console.log(`Cooperative: both players help Alice empty her stockpile\n`);
    }

    bobSocket.on('gameStateUpdate', (data) => {
      bobPlayerState = data.playerState;
      bobGameState = data.gameState;
      if (stateUpdateResolve) {
        const resolve = stateUpdateResolve;
        stateUpdateResolve = null;
        resolve(data);
      }
    });

    bobSocket.on('gameOver', (data) => {
      bobGameState = { ...bobGameState, gameOver: true, winner: data.winner };
      if (stateUpdateResolve) {
        const resolve = stateUpdateResolve;
        stateUpdateResolve = null;
        resolve({ playerState: bobPlayerState, gameState: bobGameState });
      }
    });

    function waitForBobUpdate(timeout = TIMEOUT) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          stateUpdateResolve = null;
          reject(new Error('Timeout waiting for Bob state update'));
        }, timeout);
        stateUpdateResolve = (data) => {
          clearTimeout(timer);
          resolve(data);
        };
      });
    }

    // Game loop
    let turns = 0;
    let totalPlayed = 0;

    while (turns < 200) {
      // Check game over (browser)
      const gameOver = await page.$('.game-over-overlay');
      if (gameOver) {
        const text = await gameOver.$eval('.game-over-message', (el) => el.textContent);
        console.log(`\n=== Game Over ===`);
        console.log(text.trim());
        console.log(`Turns: ${turns}, Cards played: ${totalPlayed}`);
        await page.screenshot({ path: 'hybrid-game-over.png' });
        console.log('Screenshot: hybrid-game-over.png');
        break;
      }

      if (bobGameState.gameOver) {
        await page.waitForTimeout(1000);
        continue;
      }

      const isBobsTurn = bobGameState.currentPlayerId === bobId;

      if (!isBobsTurn) {
        // Alice's turn (browser)
        const myTurnBrowser = await page.$('.turn-indicator.my-turn');
        if (!myTurnBrowser) {
          await page.waitForTimeout(500);
          continue;
        }

        turns++;
        const tag = cooperative ? ' [TARGET]' : '';
        log(`\n  Turn ${turns}: Alice${tag} (browser)`);

        let played;
        if (cooperative) {
          const stock = await getStockpileCard(page);
          const targetTop = stock ? stock.value : null;
          log(`    Alice's stockpile: ${targetTop}`);
          played = await browserPlayTurnCooperative(page, targetTop, true);
        } else {
          played = await browserPlayTurn(page);
        }
        totalPlayed += played;

        process.stdout.write(`  Turn ${turns} (Alice${tag}): played ${played} cards`);

        const gameOverCheck = await page.$('.game-over-overlay');
        if (gameOverCheck) { process.stdout.write(' -> GAME OVER\n'); continue; }

        await browserDiscard(page);
        process.stdout.write(' -> discarded\n');
        await page.waitForTimeout(300);
      } else {
        // Bob's turn (Socket.IO)
        turns++;
        const tag = cooperative ? ' [HELPER]' : '';
        log(`\n  Turn ${turns}: Bob${tag} (Socket.IO)`);
        gameAI.logState(bobPlayerState, bobGameState, log);

        // Play cards via Socket.IO
        let move;
        if (cooperative) {
          move = gameAI.findPlayableCardCooperative(bobPlayerState, bobGameState, alicePlayerId, false, log);
        } else {
          move = gameAI.findPlayableCard(bobPlayerState, bobGameState, log);
        }

        let turnPlayed = 0;
        while (move && !bobGameState.gameOver) {
          const updateP = waitForBobUpdate();
          bobSocket.emit('playCard', {
            card: move.card,
            source: move.source,
            buildingPileIndex: move.buildingPileIndex,
          });
          await updateP;
          totalPlayed++;
          turnPlayed++;
          if (bobGameState.gameOver) break;

          if (cooperative) {
            move = gameAI.findPlayableCardCooperative(bobPlayerState, bobGameState, alicePlayerId, false, log);
          } else {
            move = gameAI.findPlayableCard(bobPlayerState, bobGameState, log);
          }
        }

        process.stdout.write(`  Turn ${turns} (Bob${tag}): played ${turnPlayed} cards`);

        if (bobGameState.gameOver) {
          process.stdout.write(' -> GAME OVER\n');
          await page.waitForTimeout(1000);
          continue;
        }

        // Discard
        let discard;
        if (cooperative) {
          discard = gameAI.chooseDiscardCooperative(bobPlayerState, bobGameState, alicePlayerId, turns, log);
        } else {
          discard = gameAI.chooseDiscard(bobPlayerState, turns, log);
        }
        const updateP = waitForBobUpdate();
        bobSocket.emit('discardCard', {
          card: discard.card,
          discardPileIndex: discard.discardPileIndex,
        });
        await updateP;
        process.stdout.write(' -> discarded\n');
        await page.waitForTimeout(300);
      }
    }
  } finally {
    bobSocket.disconnect();
    await browser.close();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Error:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
