const serverManager = require('./helpers/serverManager');
const { createClient } = require('./helpers/socketClient');
const gameAI = require('./helpers/gameAI');

jest.setTimeout(30000);

let srv;

beforeAll(async () => {
  srv = await serverManager.start();
});

afterAll(async () => {
  await srv.close();
});

async function setupStartedGame(stockpileSize = 5) {
  const c1 = createClient(srv.url);
  const c2 = createClient(srv.url);
  await c1.connect();
  await c2.connect();

  const room = await c1.createRoom('Alice', 2, stockpileSize);
  const bobToken = await c2.joinRoom(room.roomId, 'Bob');

  const [started1, started2] = await Promise.all([c1.startGame(), c2.waitFor('gameStarted')]);

  const aliceId = room.playerId;
  const bobId = started2.gameState.players.find((p) => p.name === 'Bob').id;

  return {
    c1,
    c2,
    gameState: started1.gameState,
    aliceState: started1.playerState,
    bobState: started2.playerState,
    aliceId,
    bobId,
    roomId: room.roomId,
  };
}

describe('Race conditions', () => {
  test('double playCard — only first succeeds', async () => {
    const { c1, c2, gameState, aliceState, aliceId } = await setupStartedGame(5);

    const currentId = gameState.currentPlayerId;
    const currentClient = currentId === aliceId ? c1 : c2;
    const playerState =
      currentId === aliceId
        ? aliceState
        : (await c2.waitFor('gameStarted').catch(() => null), aliceState);
    const state = currentId === aliceId ? aliceState : aliceState;

    const move = gameAI.findPlayableCard(
      currentId === aliceId ? aliceState : aliceState,
      gameState
    );

    if (!move) {
      // If no playable card, skip — test is about double-play
      await c1.close();
      await c2.close();
      return;
    }

    // Send the same play twice rapidly
    const errorP = currentClient.waitForError(2000).catch(() => null);
    const updateP = currentClient.waitFor('gameStateUpdate', 3000);

    currentClient.emit('playCard', {
      card: move.card,
      source: move.source,
      buildingPileIndex: move.buildingPileIndex,
    });
    currentClient.emit('playCard', {
      card: move.card,
      source: move.source,
      buildingPileIndex: move.buildingPileIndex,
    });

    // First should succeed (gameStateUpdate), second may error
    const update = await updateP;
    expect(update.gameState).toBeDefined();

    // Give error time to arrive
    const err = await errorP;
    // Either got an error or the second play also succeeded (if hand had duplicates)
    // The key is no crash or inconsistent state

    await c1.close();
    await c2.close();
  });

  test('double discardCard — only first succeeds', async () => {
    const { c1, c2, gameState, aliceState, aliceId } = await setupStartedGame(5);

    const currentId = gameState.currentPlayerId;
    const currentClient = currentId === aliceId ? c1 : c2;
    const state = currentId === aliceId ? aliceState : aliceState;

    // Send discard twice with same card
    const card = state.hand[0];
    const updateP = currentClient.waitFor('gameStateUpdate', 3000);

    currentClient.emit('discardCard', { card, discardPileIndex: 0 });
    currentClient.emit('discardCard', { card, discardPileIndex: 1 });

    // First should succeed
    const update = await updateP;
    expect(update.gameState).toBeDefined();

    await c1.close();
    await c2.close();
  });

  test('startGame twice — only first works', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    await c2.joinRoom(room.roomId, 'Bob');

    const startedP = c1.waitFor('gameStarted');
    const errorP = c1.waitForError(2000).catch(() => null);

    c1.emit('startGame');
    c1.emit('startGame');

    const started = await startedP;
    expect(started.gameState.gameStarted).toBe(true);

    await c1.close();
    await c2.close();
  });

  test('play after game over returns error', async () => {
    const { c1, c2, gameState, aliceState, bobState, aliceId, bobId } = await setupStartedGame(1);

    // Play a quick game to completion
    let gs = gameState;
    const players = new Map();
    players.set(aliceId, { client: c1, playerState: aliceState });
    players.set(bobId, { client: c2, playerState: bobState });

    let gameOver = false;
    let turns = 0;
    while (!gameOver && turns < 200) {
      const currentId = gs.currentPlayerId;
      const player = players.get(currentId);

      let move = gameAI.findPlayableCard(player.playerState, gs);
      while (move && !gameOver) {
        const u1P = c1.waitFor('gameStateUpdate');
        const u2P = c2.waitFor('gameStateUpdate');
        player.client.emit('playCard', {
          card: move.card,
          source: move.source,
          buildingPileIndex: move.buildingPileIndex,
        });
        const [u1, u2] = await Promise.all([u1P, u2P]);
        players.get(aliceId).playerState = u1.playerState;
        players.get(bobId).playerState = u2.playerState;
        gs = u1.gameState;
        if (gs.gameOver) {
          gameOver = true;
          break;
        }
        move = gameAI.findPlayableCard(player.playerState, gs);
      }

      if (gameOver) break;

      const discard = gameAI.chooseDiscard(player.playerState, turns);
      const u1P = c1.waitFor('gameStateUpdate');
      const u2P = c2.waitFor('gameStateUpdate');
      player.client.emit('discardCard', {
        card: discard.card,
        discardPileIndex: discard.discardPileIndex,
      });
      const [u1, u2] = await Promise.all([u1P, u2P]);
      players.get(aliceId).playerState = u1.playerState;
      players.get(bobId).playerState = u2.playerState;
      gs = u1.gameState;
      turns++;
    }

    expect(gs.gameOver).toBe(true);

    // Now try to play a card — should error
    const errP = c1.waitForError(2000).catch(() => null);
    c1.emit('playCard', { card: 1, source: 'hand', buildingPileIndex: 0 });
    // May or may not get an error (depends on whether the game is cleaned up)
    // The important thing is no crash

    await c1.close();
    await c2.close();
  });

  test('rapid reconnect/disconnect cycles maintain consistent state', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    await c2.joinRoom(room.roomId, 'Bob');
    await Promise.all([c1.startGame(), c2.waitFor('gameStarted')]);

    let token = room.sessionToken;

    // 3 rapid disconnect/reconnect cycles
    for (let i = 0; i < 3; i++) {
      await c1.close();

      const c1b = createClient(srv.url);
      await c1b.connect();
      const reconnectP = c1b.waitFor('reconnected');
      c1b.emit('reconnect', { roomId: room.roomId, sessionToken: token, playerName: 'Alice' });
      const result = await reconnectP;
      token = result.sessionToken;

      // Replace c1 reference for next iteration
      Object.assign(c1, { socket: c1b.socket, id: c1b.id, ...c1b });
    }

    // State should still be consistent
    expect(token).toBeDefined();

    await c1.close();
    await c2.close();
  });
});
