const serverManager = require('./helpers/serverManager');
const { createClient } = require('./helpers/socketClient');

jest.setTimeout(30000);

let srv;

beforeAll(async () => {
  srv = await serverManager.start();
});

afterAll(async () => {
  await srv.close();
});

describe('addBot / removeBot', () => {
  test('host can add a bot to the waiting room', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const room = await c.createRoom('Alice', 4);

    const joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'improved' });
    const joined = await joinedPromise;

    expect(joined.gameState.players).toHaveLength(2);
    const bot = joined.gameState.players[1];
    expect(bot.isBot).toBe(true);
    expect(bot.aiType).toBe('improved');
    expect(bot.name).toBe('Bot 1');

    await c.close();
  });

  test('host can add a baseline bot', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const room = await c.createRoom('Alice', 4);

    const joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'baseline' });
    const joined = await joinedPromise;

    const bot = joined.gameState.players[1];
    expect(bot.isBot).toBe(true);
    expect(bot.aiType).toBe('baseline');

    await c.close();
  });

  test('invalid aiType defaults to improved', async () => {
    const c = createClient(srv.url);
    await c.connect();

    await c.createRoom('Alice', 4);

    const joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'invalid' });
    const joined = await joinedPromise;

    expect(joined.gameState.players[1].aiType).toBe('improved');

    await c.close();
  });

  test('non-host cannot add a bot', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 4);
    await c2.joinRoom(room.roomId, 'Bob');

    const errPromise = c2.waitForError();
    c2.emit('addBot', { aiType: 'improved' });
    const err = await errPromise;
    expect(err.message).toBe('error.onlyHostCanAddBot');

    await c1.close();
    await c2.close();
  });

  test('cannot add bot when room is full', async () => {
    const c = createClient(srv.url);
    await c.connect();

    await c.createRoom('Alice', 2);

    // Add one bot — fills room (2/2)
    const joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'improved' });
    await joinedPromise;

    // Try to add another
    const errPromise = c.waitForError();
    c.emit('addBot', { aiType: 'improved' });
    const err = await errPromise;
    expect(err.message).toBe('error.roomFull');

    await c.close();
  });

  test('host can remove a bot', async () => {
    const c = createClient(srv.url);
    await c.connect();

    await c.createRoom('Alice', 4);

    const joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'improved' });
    const joined = await joinedPromise;
    const botId = joined.gameState.players[1].id;

    const leftPromise = c.waitFor('playerLeft');
    c.emit('removeBot', { botPlayerId: botId });
    const left = await leftPromise;

    expect(left.gameState.players).toHaveLength(1);
    expect(left.gameState.players[0].name).toBe('Alice');

    await c.close();
  });

  test('non-host cannot remove a bot', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 4);
    await c2.joinRoom(room.roomId, 'Bob');

    const joinedPromise = c1.waitFor('playerJoined');
    c1.emit('addBot', { aiType: 'improved' });
    const joined = await joinedPromise;
    const botId = joined.gameState.players[2].id;

    const errPromise = c2.waitForError();
    c2.emit('removeBot', { botPlayerId: botId });
    const err = await errPromise;
    expect(err.message).toBe('error.onlyHostCanRemoveBot');

    await c1.close();
    await c2.close();
  });

  test('cannot remove a human player via removeBot', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 4);
    const token = await c2.joinRoom(room.roomId, 'Bob');

    const errPromise = c1.waitForError();
    c1.emit('removeBot', { botPlayerId: token.playerId });
    const err = await errPromise;
    expect(err.message).toBe('error.notABot');

    await c1.close();
    await c2.close();
  });
});

describe('bot turn driver', () => {
  test('bot plays automatically after human ends turn', async () => {
    const c = createClient(srv.url);
    await c.connect();

    await c.createRoom('Alice', 2, 5);

    // Add a bot
    const joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'improved' });
    await joinedPromise;

    // Start game — human (player 0) always goes first
    const startedPromise = c.waitFor('gameStarted');
    c.emit('startGame');
    const started = await startedPromise;

    // Human discards to end their turn
    await c.discardCard(started.playerState.hand[0], 0);

    // Bot should now play automatically — wait for its gameStateUpdate
    const update = await c.waitFor('gameStateUpdate', 10000);
    expect(update.gameState).toBeDefined();
    expect(update.playerState).toBeDefined();

    await c.close();
  });

  test('multiple bots play in sequence', async () => {
    const c = createClient(srv.url);
    await c.connect();

    await c.createRoom('Alice', 3, 5);

    // Add two bots
    let joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'improved' });
    await joinedPromise;

    joinedPromise = c.waitFor('playerJoined');
    c.emit('addBot', { aiType: 'baseline' });
    const joined = await joinedPromise;

    expect(joined.gameState.players).toHaveLength(3);
    expect(joined.gameState.players[1].isBot).toBe(true);
    expect(joined.gameState.players[2].isBot).toBe(true);

    // Start game — human (player 0) goes first
    const startedPromise = c.waitFor('gameStarted');
    c.emit('startGame');
    const started = await startedPromise;

    // Human discards to end their turn, triggering bot turns
    await c.discardCard(started.playerState.hand[0], 0);

    // Wait for at least one bot update
    const update = await c.waitFor('gameStateUpdate', 10000);
    expect(update.gameState).toBeDefined();

    await c.close();
  });
});
