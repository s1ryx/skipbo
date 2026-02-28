const serverManager = require('./helpers/serverManager');
const { createClient } = require('./helpers/socketClient');
const gameAI = require('./helpers/gameAI');

jest.setTimeout(60000);

let srv;

beforeAll(async () => {
  srv = await serverManager.start();
});

afterAll(async () => {
  await srv.close();
});

/**
 * Helper: set up a 2-player game and start it.
 */
async function setupGame(stockpileSize = 5) {
  const c1 = createClient(srv.url);
  const c2 = createClient(srv.url);
  await c1.connect();
  await c2.connect();

  const room = await c1.createRoom('Alice', 2, stockpileSize);
  await c2.joinRoom(room.roomId, 'Bob');

  const [started1, started2] = await Promise.all([
    c1.startGame(),
    c2.waitFor('gameStarted'),
  ]);

  const aliceId = room.playerId;
  const bobId = started2.gameState.players.find((p) => p.name === 'Bob').id;

  const players = new Map();
  players.set(aliceId, { client: c1, playerState: started1.playerState });
  players.set(bobId, { client: c2, playerState: started2.playerState });

  return { c1, c2, players, gameState: started1.gameState, aliceId, bobId };
}

/**
 * Emit a playCard and wait for both clients to receive gameStateUpdate.
 */
async function emitPlayCard(client, c1, c2, players, { card, source, buildingPileIndex }) {
  const u1P = c1.waitFor('gameStateUpdate');
  const u2P = c2.waitFor('gameStateUpdate');

  client.emit('playCard', { card, source, buildingPileIndex });

  const [u1, u2] = await Promise.all([u1P, u2P]);

  const keys = Array.from(players.keys());
  players.get(keys[0]).playerState = u1.playerState;
  players.get(keys[1]).playerState = u2.playerState;

  return { gameState: u1.gameState, u1, u2 };
}

/**
 * Emit a discardCard and wait for both clients to receive gameStateUpdate.
 */
async function emitDiscard(client, c1, c2, players, { card, discardPileIndex }) {
  const u1P = c1.waitFor('gameStateUpdate');
  const u2P = c2.waitFor('gameStateUpdate');

  client.emit('discardCard', { card, discardPileIndex });

  const [u1, u2] = await Promise.all([u1P, u2P]);

  const keys = Array.from(players.keys());
  players.get(keys[0]).playerState = u1.playerState;
  players.get(keys[1]).playerState = u2.playerState;

  return { gameState: u1.gameState, u1, u2 };
}

/**
 * Play a complete game using AI. Returns { winner, turns, gameState }.
 */
async function playGame(c1, c2, players, initialGameState) {
  let gameState = initialGameState;
  let turns = 0;
  const MAX_TURNS = 500;

  while (!gameState.gameOver && turns < MAX_TURNS) {
    const currentId = gameState.currentPlayerId;
    const player = players.get(currentId);
    if (!player) throw new Error(`No player found for id ${currentId}`);

    // Play as many cards as possible
    let move = gameAI.findPlayableCard(player.playerState, gameState);
    while (move && !gameState.gameOver) {
      const result = await emitPlayCard(player.client, c1, c2, players, move);
      gameState = result.gameState;
      move = gameState.gameOver ? null : gameAI.findPlayableCard(player.playerState, gameState);
    }

    if (gameState.gameOver) break;

    // Discard to end turn
    const discard = gameAI.chooseDiscard(player.playerState, turns);
    if (!discard.card) throw new Error('No card to discard — hand empty but game not over');

    const result = await emitDiscard(player.client, c1, c2, players, discard);
    gameState = result.gameState;
    turns++;
  }

  return { winner: gameState.winner, turns, gameState };
}

describe('Full game playthrough', () => {
  test('2-player game completes with a winner', async () => {
    const { c1, c2, players, gameState } = await setupGame(3);

    const { winner, turns, gameState: finalState } = await playGame(c1, c2, players, gameState);

    expect(finalState.gameOver).toBe(true);
    expect(winner).toBeDefined();
    expect(winner.name).toMatch(/^(Alice|Bob)$/);
    expect(turns).toBeGreaterThan(0);

    await c1.close();
    await c2.close();
  });

  test('both players see consistent building piles', async () => {
    const { c1, c2, players, gameState } = await setupGame(3);

    const currentId = gameState.currentPlayerId;
    const player = players.get(currentId);

    const move = gameAI.findPlayableCard(player.playerState, gameState);
    if (move) {
      const { u1, u2 } = await emitPlayCard(player.client, c1, c2, players, move);

      expect(u1.gameState.buildingPiles).toEqual(u2.gameState.buildingPiles);
      expect(u1.gameState.currentPlayerId).toBe(u2.gameState.currentPlayerId);
      expect(u1.gameState.deckCount).toBe(u2.gameState.deckCount);
    }

    await c1.close();
    await c2.close();
  });

  test('player hand is private (not in gameState)', async () => {
    const { c1, c2, players, gameState } = await setupGame(3);

    for (const p of gameState.players) {
      expect(p.handCount).toBeDefined();
      expect(p.hand).toBeUndefined();
      expect(p.stockpileCount).toBeDefined();
      expect(p.stockpile).toBeUndefined();
    }

    for (const [, player] of players) {
      expect(player.playerState.hand).toBeInstanceOf(Array);
      expect(player.playerState.hand.length).toBeGreaterThan(0);
    }

    await c1.close();
    await c2.close();
  });

  test('turn changes after discard', async () => {
    const { c1, c2, players, gameState } = await setupGame(3);

    const firstPlayerId = gameState.currentPlayerId;
    const player = players.get(firstPlayerId);

    const discard = gameAI.chooseDiscard(player.playerState, 0);

    const turnChangedP = c1.waitFor('turnChanged');
    const result = await emitDiscard(player.client, c1, c2, players, discard);

    const turnData = await turnChangedP;
    expect(turnData.currentPlayerId).not.toBe(firstPlayerId);

    await c1.close();
    await c2.close();
  });
});
