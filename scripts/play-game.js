#!/usr/bin/env node

/**
 * Socket.IO Self-Play Script
 *
 * Starts a server, connects two AI players via Socket.IO,
 * and plays a complete game of Skip-Bo.
 *
 * Usage:
 *   node scripts/play-game.js [--stockpile N] [--players N] [--verbose] [--cooperative]
 *
 * Modes:
 *   --cooperative  All players collaborate to empty Player 1's stockpile
 *   --verbose      Print AI decision-making for each turn
 */

const path = require('path');
const createServer = require(path.join(__dirname, '..', 'server', 'createServer'));
const { io } = require(path.join(__dirname, '..', 'server', 'node_modules', 'socket.io-client'));
const gameAI = require(
  path.join(__dirname, '..', 'server', 'tests', 'integration', 'helpers', 'gameAI')
);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const cooperative = args.includes('--cooperative') || args.includes('--coop');
const stockpileSize = parseInt(args.find((_, i, a) => a[i - 1] === '--stockpile') || '5', 10);
const playerCount = parseInt(args.find((_, i, a) => a[i - 1] === '--players') || '2', 10);

function log(...msg) {
  if (verbose) console.log(...msg);
}

function createClient(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { forceNew: true, transports: ['websocket'] });
    const timeout = setTimeout(() => reject(new Error('Connect timeout')), 5000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitFor(socket, event, timeout = 10000) {
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

async function main() {
  const mode = cooperative ? 'cooperative' : 'competitive';
  console.log(`\n=== Skip-Bo Self-Play (${mode}) ===`);
  console.log(`Players: ${playerCount}, Stockpile: ${stockpileSize} cards\n`);

  // Start server
  const { server, coordinator, transport } = createServer({ rateLimitMax: 200 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  log(`Server started on ${url}`);

  const sockets = [];
  const playerNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'].slice(0, playerCount);

  try {
    // Connect all players
    for (const name of playerNames) {
      const socket = await createClient(url);
      sockets.push(socket);
      log(`${name} connected (${socket.id})`);
    }

    // Player 1 creates room
    const roomCreatedP = waitFor(sockets[0], 'roomCreated');
    sockets[0].emit('createRoom', {
      playerName: playerNames[0],
      maxPlayers: playerCount,
      stockpileSize,
    });
    const roomData = await roomCreatedP;
    const roomId = roomData.roomId;
    console.log(`Room ${roomId} created by ${playerNames[0]}`);

    // Other players join
    const playerIds = new Map();
    playerIds.set(roomData.playerId, {
      socket: sockets[0],
      name: playerNames[0],
      playerState: null,
    });

    for (let i = 1; i < playerCount; i++) {
      const tokenP = waitFor(sockets[i], 'sessionToken');
      sockets[i].emit('joinRoom', { roomId, playerName: playerNames[i] });
      const token = await tokenP;
      playerIds.set(token.playerId, {
        socket: sockets[i],
        name: playerNames[i],
        playerState: null,
      });
      log(`${playerNames[i]} joined room`);
    }

    // Start game
    const startPromises = sockets.map((s) => waitFor(s, 'gameStarted'));
    sockets[0].emit('startGame');
    const startResults = await Promise.all(startPromises);

    // Map player states by socket index
    const idBySocketIndex = Array.from(playerIds.keys());
    for (let i = 0; i < sockets.length; i++) {
      playerIds.get(idBySocketIndex[i]).playerState = startResults[i].playerState;
    }

    let gameState = startResults[0].gameState;
    console.log(
      `Game started! ${gameState.players.length} players, ${gameState.deckCount} cards in deck`
    );

    // In cooperative mode, player 0 is the target
    const targetPlayerId = cooperative ? idBySocketIndex[0] : null;
    if (cooperative) {
      const targetName = playerIds.get(targetPlayerId).name;
      console.log(`Cooperative mode: all players help ${targetName} empty her stockpile\n`);
    }

    // Game loop
    let turns = 0;
    let cardsPlayed = 0;
    const MAX_TURNS = 1000;

    while (!gameState.gameOver && turns < MAX_TURNS) {
      const currentId = gameState.currentPlayerId;
      const player = playerIds.get(currentId);
      if (!player) throw new Error(`No player for id ${currentId}`);

      const isTarget = currentId === targetPlayerId;
      const tag = cooperative ? (isTarget ? ' [TARGET]' : ' [HELPER]') : '';
      log(`\n--- Turn ${turns + 1}: ${player.name}${tag} ---`);
      gameAI.logState(player.playerState, gameState, log);

      // Play cards
      let move;
      if (cooperative) {
        move = gameAI.findPlayableCardCooperative(
          player.playerState,
          gameState,
          targetPlayerId,
          isTarget,
          log
        );
      } else {
        move = gameAI.findPlayableCard(player.playerState, gameState, log);
      }

      while (move && !gameState.gameOver) {
        const updatePromises = sockets.map((s) => waitFor(s, 'gameStateUpdate'));
        player.socket.emit('playCard', {
          card: move.card,
          source: move.source,
          buildingPileIndex: move.buildingPileIndex,
        });

        const updates = await Promise.all(updatePromises);
        for (let i = 0; i < sockets.length; i++) {
          playerIds.get(idBySocketIndex[i]).playerState = updates[i].playerState;
        }
        gameState = updates[0].gameState;
        cardsPlayed++;

        if (gameState.gameOver) break;

        if (cooperative) {
          move = gameAI.findPlayableCardCooperative(
            player.playerState,
            gameState,
            targetPlayerId,
            isTarget,
            log
          );
        } else {
          move = gameAI.findPlayableCard(player.playerState, gameState, log);
        }
      }

      if (gameState.gameOver) break;

      // Discard
      let discard;
      if (cooperative) {
        discard = gameAI.chooseDiscardCooperative(
          player.playerState,
          gameState,
          targetPlayerId,
          turns,
          log
        );
      } else {
        discard = gameAI.chooseDiscard(player.playerState, turns, log);
      }

      const discardPromises = sockets.map((s) => waitFor(s, 'gameStateUpdate'));
      player.socket.emit('discardCard', {
        card: discard.card,
        discardPileIndex: discard.discardPileIndex,
      });

      const discardUpdates = await Promise.all(discardPromises);
      for (let i = 0; i < sockets.length; i++) {
        playerIds.get(idBySocketIndex[i]).playerState = discardUpdates[i].playerState;
      }
      gameState = discardUpdates[0].gameState;
      turns++;

      if (!verbose) {
        process.stdout.write(
          `  Turn ${turns} (${player.name}${tag}): ${cardsPlayed} total cards played\r`
        );
      }
    }

    // Results
    console.log(`\n\n=== Game Over ===`);
    if (gameState.winner) {
      console.log(`Winner: ${gameState.winner.name}`);
    } else {
      console.log(`Game did not finish within ${MAX_TURNS} turns`);
    }
    console.log(`Turns: ${turns}`);
    console.log(`Cards played: ${cardsPlayed}`);
    console.log(`Remaining stockpiles:`);
    for (const p of gameState.players) {
      console.log(`  ${p.name}: ${p.stockpileCount} cards`);
    }
  } finally {
    // Cleanup
    for (const s of sockets) {
      s.disconnect();
    }
    transport.io.close();
    await new Promise((resolve) => server.close(resolve));
    for (const t of coordinator.pendingDeletions.values()) clearTimeout(t);
    for (const t of coordinator.completedGameTimers.values()) clearTimeout(t);
    log('\nServer shut down cleanly');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
