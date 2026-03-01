#!/usr/bin/env node

/**
 * Direct Self-Play Script — AI vs AI without Socket.IO overhead.
 *
 * Uses SkipBoGame directly with the new AIPlayer module.
 * Supports running multiple games for statistical validation.
 *
 * Usage:
 *   node scripts/play-game-direct.js [options]
 *
 * Options:
 *   --stockpile N    Stockpile size per player (default: 30)
 *   --players N      Number of players (default: 2)
 *   --games N        Number of games to simulate (default: 1)
 *   --verbose, -v    Print AI decision-making for each turn
 *   --old-ai         Use old heuristic AI instead of new AIPlayer
 *   --compare        Run both AIs and compare results
 */

const path = require('path');
const SkipBoGame = require(path.join(__dirname, '..', 'server', 'gameLogic'));
const { AIPlayer } = require(path.join(__dirname, '..', 'server', 'ai', 'AIPlayer'));
const gameAI = require(path.join(__dirname, '..', 'server', 'tests', 'integration', 'helpers', 'gameAI'));

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const useOldAI = args.includes('--old-ai');
const compare = args.includes('--compare');
const stockpileSize = parseInt(args.find((_, i, a) => a[i - 1] === '--stockpile') || '30', 10);
const playerCount = parseInt(args.find((_, i, a) => a[i - 1] === '--players') || '2', 10);
const gameCount = parseInt(args.find((_, i, a) => a[i - 1] === '--games') || '1', 10);

function log(...msg) {
  if (verbose) console.log(...msg);
}

/**
 * Play a single game and return stats.
 */
function playGame(aiType) {
  const game = new SkipBoGame('selfplay', playerCount, stockpileSize);

  // Add players
  const playerIds = [];
  const playerNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'].slice(0, playerCount);
  for (let i = 0; i < playerCount; i++) {
    const id = `player-${i}`;
    game.addPlayer(id, playerNames[i]);
    playerIds.push(id);
  }

  game.startGame();

  // Create AI instances (one per player for independent card counters)
  const ais = playerIds.map(() => new AIPlayer({ log }));

  let turns = 0;
  let cardsPlayed = 0;
  const MAX_TURNS = 2000;

  while (!game.gameOver && turns < MAX_TURNS) {
    const currentPlayer = game.getCurrentPlayer();
    const playerId = currentPlayer.id;
    const playerIndex = playerIds.indexOf(playerId);
    const ai = ais[playerIndex];

    const gameState = game.getGameState();
    const playerState = game.getPlayerState(playerId);

    log(`\n--- Turn ${turns + 1}: ${currentPlayer.name} ---`);
    log(`  Hand: [${playerState.hand.join(', ')}]`);
    log(`  Stock: ${playerState.stockpileTop ?? 'empty'} (${playerState.stockpileCount} left)`);

    // Play phase
    let playCount = 0;
    let move;

    if (aiType === 'new') {
      move = ai.findPlayableCard(playerState, gameState, log);
    } else {
      move = gameAI.findPlayableCard(playerState, gameState, log);
    }

    while (move && !game.gameOver) {
      const result = game.playCard(playerId, move.card, move.source, move.buildingPileIndex);
      if (!result.success) {
        log(`  !! PLAY FAILED: ${result.error} (card=${move.card}, source=${move.source}, pile=${move.buildingPileIndex})`);
        break;
      }

      cardsPlayed++;
      playCount++;

      if (game.gameOver) break;

      // Re-fetch state after play (hand may have changed, pile may have reset)
      const newGameState = game.getGameState();
      const newPlayerState = game.getPlayerState(playerId);

      if (aiType === 'new') {
        move = ai.findPlayableCard(newPlayerState, newGameState, log);
      } else {
        move = gameAI.findPlayableCard(newPlayerState, newGameState, log);
      }
    }

    if (game.gameOver) break;

    // Discard phase
    const discardGameState = game.getGameState();
    const discardPlayerState = game.getPlayerState(playerId);

    let discard;
    if (aiType === 'new') {
      discard = ai.chooseDiscard(discardPlayerState, discardGameState, log);
    } else {
      discard = gameAI.chooseDiscard(discardPlayerState, turns, log);
    }

    if (discard) {
      const discardResult = game.discardCard(playerId, discard.card, discard.discardPileIndex);
      if (!discardResult.success) {
        log(`  !! DISCARD FAILED: ${discardResult.error} (card=${discard.card}, pile=${discard.discardPileIndex})`);
      }
    }

    // End turn (advances to next player, draws cards for them)
    game.endTurn(playerId);
    turns++;

    if (!verbose && gameCount === 1) {
      const stocks = game.players.map((p) => p.stockpile.length);
      process.stdout.write(`  Turn ${turns}: plays=${playCount}, stocks=[${stocks.join(',')}]\r`);
    }
  }

  const gameState = game.getGameState();
  const winnerName = gameState.winner ? gameState.winner.name : null;
  const stockpiles = game.players.map((p) => ({ name: p.name, remaining: p.stockpile.length }));

  return { turns, cardsPlayed, winnerName, stockpiles, timedOut: turns >= MAX_TURNS };
}

/**
 * Run multiple games and aggregate stats.
 */
function runSuite(aiType, numGames) {
  const results = [];
  const wins = {};

  for (let i = 0; i < numGames; i++) {
    const result = playGame(aiType);
    results.push(result);

    if (result.winnerName) {
      wins[result.winnerName] = (wins[result.winnerName] || 0) + 1;
    }

    if (numGames > 1 && !verbose) {
      process.stdout.write(`  Game ${i + 1}/${numGames}: ${result.winnerName || 'timeout'} in ${result.turns} turns\r`);
    }
  }

  if (numGames > 1) process.stdout.write('\n');

  const turnCounts = results.map((r) => r.turns);
  const cardCounts = results.map((r) => r.cardsPlayed);
  const timeouts = results.filter((r) => r.timedOut).length;

  return {
    games: numGames,
    wins,
    timeouts,
    turns: {
      min: Math.min(...turnCounts),
      max: Math.max(...turnCounts),
      avg: (turnCounts.reduce((a, b) => a + b, 0) / numGames).toFixed(1),
      median: turnCounts.sort((a, b) => a - b)[Math.floor(numGames / 2)],
    },
    cards: {
      avg: (cardCounts.reduce((a, b) => a + b, 0) / numGames).toFixed(1),
    },
  };
}

function printStats(label, stats) {
  console.log(`\n  ${label}:`);
  console.log(`    Games: ${stats.games} (${stats.timeouts} timeouts)`);
  console.log(`    Wins: ${Object.entries(stats.wins).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`);
  console.log(`    Turns: min=${stats.turns.min}, max=${stats.turns.max}, avg=${stats.turns.avg}, median=${stats.turns.median}`);
  console.log(`    Cards played (avg): ${stats.cards.avg}`);
}

// Main
console.log(`\n=== Skip-Bo Direct Self-Play ===`);
console.log(`Players: ${playerCount}, Stockpile: ${stockpileSize}, Games: ${gameCount}`);

if (compare) {
  console.log(`\nRunning comparison: new AI vs old AI...`);
  const newStats = runSuite('new', gameCount);
  const oldStats = runSuite('old', gameCount);

  printStats('New AIPlayer', newStats);
  printStats('Old heuristic AI', oldStats);

  console.log(`\n  Comparison:`);
  console.log(`    Avg turns: new=${newStats.turns.avg} vs old=${oldStats.turns.avg}`);
  console.log(`    Timeouts:  new=${newStats.timeouts} vs old=${oldStats.timeouts}`);
} else {
  const aiType = useOldAI ? 'old' : 'new';
  const label = useOldAI ? 'Old heuristic AI' : 'New AIPlayer';
  console.log(`AI: ${label}\n`);

  if (gameCount === 1) {
    const result = playGame(aiType);
    console.log(`\n\n=== Game Over ===`);
    console.log(`Winner: ${result.winnerName || 'none (timeout)'}`);
    console.log(`Turns: ${result.turns}`);
    console.log(`Cards played: ${result.cardsPlayed}`);
    console.log(`Remaining stockpiles:`);
    for (const s of result.stockpiles) {
      console.log(`  ${s.name}: ${s.remaining} cards`);
    }
  } else {
    const stats = runSuite(aiType, gameCount);
    printStats(label, stats);
  }
}

console.log('');
