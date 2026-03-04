#!/usr/bin/env node

/**
 * Play vs AI — Join a room as an AI bot.
 *
 * The human creates a room in the browser UI, then runs this script
 * to add an AI opponent. The human starts the game from the browser.
 *
 * Usage:
 *   node scripts/play-vs-ai.js --join ROOMID [options]
 *
 * Options:
 *   --join ROOMID      Room code to join (required)
 *   --ai new|old       AI type: 'new' (AIPlayer) or 'old' (heuristic) [default: new]
 *   --delay N          Delay between AI moves in ms [default: 800]
 *   --verbose, -v      Detailed AI reasoning [default: on]
 *   --quiet, -q        Suppress detailed reasoning
 *   --port N           Server port to connect to [default: 3001]
 *   --name NAME        AI display name [default: 'AI Bot']
 */

const path = require('path');
const { io } = require(path.join(__dirname, '..', 'server', 'node_modules', 'socket.io-client'));
const { AISocketClient } = require(path.join(__dirname, '..', 'server', 'ai', 'AISocketClient'));

// ── Parse arguments ───────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}

const roomId = getArg('join', null);
const aiType = getArg('ai', 'new');
const delay = parseInt(getArg('delay', '800'), 10);
const verbose = !args.includes('--quiet') && !args.includes('-q');
const port = parseInt(getArg('port', '3001'), 10);
const aiName = getArg('name', 'AI Bot');

if (!roomId) {
  console.error('Error: --join ROOMID is required');
  console.error('');
  console.error('Usage: node scripts/play-vs-ai.js --join ROOMID [--ai new|old] [--delay N]');
  console.error('');
  console.error('First create a room in the browser, then run this script with the room code.');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const aiLabel = aiType === 'old' ? 'Old heuristic AI' : 'New AIPlayer';
  const serverUrl = `http://localhost:${port}`;

  console.log('\n\x1b[1m=== Skip-Bo: Play vs AI ===\x1b[0m');
  console.log(`AI: ${aiLabel} (${aiName})`);
  console.log(`Server: ${serverUrl}`);
  console.log(`Delay: ${delay}ms\n`);

  const aiClient = new AISocketClient(io, {
    serverUrl,
    name: aiName,
    aiType,
    delay,
    verbose,
  });

  try {
    await aiClient.joinRoom(roomId);
    console.log(`\x1b[32mJoined room: ${roomId}\x1b[0m`);
    console.log('Waiting for the host to start the game...\n');

    const result = await aiClient.waitForGameEnd();

    console.log('\n\x1b[1m=== Final Results ===\x1b[0m');
    if (result.winner) {
      console.log(`Winner: ${result.winner.name}`);
    }
  } catch (err) {
    console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
  } finally {
    aiClient.disconnect();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\x1b[31mError:\x1b[0m', err.message);
    process.exit(1);
  });
