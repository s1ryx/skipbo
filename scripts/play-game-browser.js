#!/usr/bin/env node

/**
 * Playwright Browser Self-Play Script
 *
 * Opens two browser windows and plays a complete game of Skip-Bo
 * through the React client UI.
 *
 * Prerequisites:
 *   - Server running: cd server && npm start
 *   - Client running: cd client && npm start
 *   OR use --auto-start to start both automatically
 *
 * Usage:
 *   node scripts/play-game-browser.js [--headed] [--auto-start] [--stockpile N] [--verbose] [--cooperative]
 *
 * Modes:
 *   --cooperative  Both players collaborate to empty Player 1's stockpile
 *   --verbose      Print AI decision-making for each turn
 */

const path = require('path');
const { spawn } = require('child_process');
const { firefox } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const autoStart = args.includes('--auto-start');
const verbose = args.includes('--verbose') || args.includes('-v');
const cooperative = args.includes('--cooperative') || args.includes('--coop');
const stockpileSize = parseInt(args.find((_, i, a) => a[i - 1] === '--stockpile') || '5', 10);

const SERVER_URL = 'http://localhost:3001';
const CLIENT_URL = 'http://localhost:3000';
const TIMEOUT = 10000;

let serverProc = null;
let clientProc = null;

function log(...msg) {
  if (verbose) console.log(...msg);
}

async function startServers() {
  if (!autoStart) return;

  console.log('Starting server...');
  serverProc = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..', 'server'),
    stdio: 'pipe',
    env: { ...process.env, PORT: '3001' },
  });

  await new Promise((resolve) => {
    serverProc.stdout.on('data', (data) => {
      if (data.toString().includes('running on')) resolve();
    });
    setTimeout(resolve, 3000);
  });

  console.log('Starting client...');
  clientProc = spawn('npx', ['react-scripts', 'start'], {
    cwd: path.join(__dirname, '..', 'client'),
    stdio: 'pipe',
    env: { ...process.env, PORT: '3000', BROWSER: 'none', REACT_APP_SERVER_URL: SERVER_URL },
  });

  await new Promise((resolve) => {
    clientProc.stdout.on('data', (data) => {
      if (data.toString().includes('Compiled') || data.toString().includes('webpack')) resolve();
    });
    setTimeout(resolve, 15000);
  });

  console.log('Both servers ready');
}

function stopServers() {
  if (serverProc) serverProc.kill();
  if (clientProc) clientProc.kill();
}

async function clickButton(page, text) {
  await page.click(`button:has-text("${text}")`, { timeout: TIMEOUT });
}

// ─── Card reading helpers ───────────────────────────────────────────

async function getNextValues(page) {
  const piles = await page.$$('.building-pile');
  const nextValues = [];
  for (const pile of piles) {
    // Read .next-card span directly to avoid card value text bleeding into the match
    const nextCard = await pile.$('.next-card');
    if (nextCard) {
      const text = await nextCard.textContent();
      const match = text.match(/(\d+)/);
      nextValues.push(match ? parseInt(match[1], 10) : null);
    } else {
      const emptyText = await pile.$('.empty-pile-text');
      nextValues.push(emptyText ? 1 : null);
    }
  }
  return nextValues;
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
  const stockpile = await page.$('.stockpile-section .card-clickable');
  if (!stockpile) return null;
  const value = await getCardValue(stockpile);
  return value !== null ? { value, element: stockpile } : null;
}

async function getDiscardTopCards(page) {
  const piles = await page.$$('.discard-pile');
  const cards = [];
  for (let i = 0; i < piles.length; i++) {
    const topCard = await piles[i].$('.top-card');
    if (!topCard) continue;
    const value = await getCardValue(topCard);
    if (value !== null) cards.push({ value, element: topCard, source: `discard${i}` });
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

function canPlay(cardValue, nextValue) {
  if (nextValue === null) return false;
  if (cardValue === 'SKIP-BO') return true;
  return cardValue === nextValue;
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

// ─── Competitive play ───────────────────────────────────────────────

async function playTurn(page) {
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

    // 2. Hand number cards (save SKIP-BO)
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

    // 4. SKIP-BO from hand (last resort)
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

// ─── Cooperative play ───────────────────────────────────────────────

async function playTurnCooperative(page, targetStockpileTop, isTargetPlayer) {
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
        // SKIP-BO stockpile on any non-complete pile
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

// ─── Discard ────────────────────────────────────────────────────────

async function discardCard(page) {
  const endTurnBtn = await page.$('button.btn-end-turn');
  if (endTurnBtn) {
    await endTurnBtn.click({ force: true });
    await page.waitForTimeout(300);
  }

  const handCards = await getHandCards(page);
  if (handCards.length === 0) return;

  // Pick highest non-SKIP-BO card to discard
  const nonSkipBo = handCards.filter((c) => c.value !== 'SKIP-BO');
  const cardToDiscard = nonSkipBo.length > 0
    ? nonSkipBo.sort((a, b) => b.value - a.value)[0]
    : handCards[0];

  log(`    Discard ${cardToDiscard.value}`);
  await cardToDiscard.element.click({ force: true });
  await page.waitForTimeout(200);

  // Smart discard pile selection (matches gameAI.js pickDiscardPile logic)
  const discardPiles = await page.$$('.discard-pile');
  if (discardPiles.length === 0) return;

  const tops = [];
  for (let d = 0; d < discardPiles.length; d++) {
    const topCard = await discardPiles[d].$('.top-card');
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

  await discardPiles[bestPile].click({ force: true });
  await page.waitForTimeout(500);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const mode = cooperative ? 'cooperative' : 'competitive';
  console.log(`\n=== Skip-Bo Browser Self-Play (${mode}) ===`);
  console.log(`Mode: ${headed ? 'headed' : 'headless'}, Stockpile: ${stockpileSize}\n`);

  await startServers();

  const browser = await firefox.launch({ headless: !headed });

  try {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Player 1: Create room
    console.log('Player 1 (Alice): Creating room...');
    await page1.goto(CLIENT_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page1.fill('input[placeholder="Enter your name"]', 'Alice');

    const slider = await page1.$('input.stockpile-slider');
    if (slider) {
      await slider.evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, stockpileSize);
    }

    await clickButton(page1, 'Create Room');
    await page1.waitForSelector('.waiting-room h2', { timeout: TIMEOUT });
    const roomHeader = await page1.$eval('.waiting-room h2', (el) => el.textContent);
    const roomId = roomHeader.replace(/Room:\s*/i, '').trim();
    console.log(`Room created: ${roomId}`);

    // Player 2: Join room
    console.log('Player 2 (Bob): Joining room...');
    await page2.goto(CLIENT_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await clickButton(page2, 'Join Existing Room');
    await page2.fill('input[placeholder="Enter your name"]', 'Bob');
    await page2.fill('input[placeholder="Enter room ID"]', roomId);
    await clickButton(page2, 'Join Room');
    await page2.waitForSelector('.waiting-room h2', { timeout: TIMEOUT });
    console.log('Bob joined');

    // Player 1: Start game
    console.log('Starting game...');
    await page1.waitForSelector('button.btn-start-game', { timeout: TIMEOUT });
    await clickButton(page1, 'Start Game');
    await page1.waitForSelector('.game-board', { timeout: TIMEOUT });
    await page2.waitForSelector('.game-board', { timeout: TIMEOUT });
    console.log('Game started!');

    if (cooperative) {
      console.log('Cooperative: both players help Alice empty her stockpile\n');
    }

    // Game loop
    let turns = 0;
    let totalCardsPlayed = 0;
    const MAX_TURNS = 200;
    const pages = [page1, page2];
    const names = ['Alice', 'Bob'];
    const targetIndex = 0; // Alice is the cooperative target

    while (turns < MAX_TURNS) {
      const gameOver1 = await page1.$('.game-over-overlay');
      const gameOver2 = await page2.$('.game-over-overlay');
      if (gameOver1 || gameOver2) {
        const overlay = gameOver1 || gameOver2;
        const winnerText = await overlay.$eval('.game-over-message', (el) => el.textContent);
        console.log(`\n=== Game Over ===`);
        console.log(winnerText.trim());
        console.log(`Turns: ${turns}, Cards played: ${totalCardsPlayed}`);

        await page1.screenshot({ path: 'game-over-p1.png' });
        await page2.screenshot({ path: 'game-over-p2.png' });
        console.log('Screenshots saved: game-over-p1.png, game-over-p2.png');
        break;
      }

      // Find whose turn it is
      let currentPage = null;
      let currentName = null;
      let currentIndex = -1;
      for (let i = 0; i < pages.length; i++) {
        const myTurn = await pages[i].$('.turn-indicator.my-turn');
        if (myTurn) {
          currentPage = pages[i];
          currentName = names[i];
          currentIndex = i;
          break;
        }
      }

      if (!currentPage) {
        await page1.waitForTimeout(500);
        continue;
      }

      turns++;
      const isTarget = currentIndex === targetIndex;
      const tag = cooperative ? (isTarget ? ' [TARGET]' : ' [HELPER]') : '';

      let cardsPlayed;
      if (cooperative) {
        // Read target's stockpile: from own view if target, from opponent section otherwise
        let targetStockpileTop;
        if (isTarget) {
          const stock = await getStockpileCard(currentPage);
          targetStockpileTop = stock ? stock.value : null;
        } else {
          targetStockpileTop = await getOpponentStockpileTop(currentPage);
        }
        log(`\n  Turn ${turns} (${currentName}${tag}): target stockpile=${targetStockpileTop}`);
        cardsPlayed = await playTurnCooperative(currentPage, targetStockpileTop, isTarget);
      } else {
        log(`\n  Turn ${turns} (${currentName}):`);
        cardsPlayed = await playTurn(currentPage);
      }

      totalCardsPlayed += cardsPlayed;
      process.stdout.write(`  Turn ${turns} (${currentName}${tag}): played ${cardsPlayed} cards`);

      const gameOverCheck = await currentPage.$('.game-over-overlay');
      if (gameOverCheck) { process.stdout.write(' -> GAME OVER\n'); continue; }

      await discardCard(currentPage);
      process.stdout.write(' -> discarded\n');
      await page1.waitForTimeout(300);
    }

    if (turns >= MAX_TURNS) {
      console.log(`Game did not finish in ${MAX_TURNS} turns`);
    }
  } finally {
    await browser.close();
    stopServers();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Error:', err.message);
  if (err.stack) console.error(err.stack);
  stopServers();
  process.exit(1);
});
