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

describe('Game abort and leave', () => {
  test('leaveGame mid-play sends gameAborted to all', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    await c2.joinRoom(room.roomId, 'Bob');
    await Promise.all([c1.startGame(), c2.waitFor('gameStarted')]);

    const abortP = c2.waitFor('gameAborted');
    c1.emit('leaveGame');
    await abortP;

    // Room should be cleaned up — new join should fail
    const c3 = createClient(srv.url);
    await c3.connect();
    const errP = c3.waitForError();
    c3.emit('joinRoom', { roomId: room.roomId, playerName: 'Charlie' });
    const err = await errP;
    expect(err.message).toBe('error.roomNotFound');

    await c1.close();
    await c2.close();
    await c3.close();
  });

  test('disconnect in lobby (non-host) sends playerLeft', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    const leftP = c1.waitFor('playerLeft');
    await c2.close();
    const left = await leftP;

    expect(left.gameState.players).toHaveLength(1);
    expect(left.gameState.players[0].name).toBe('Alice');

    await c1.close();
  });

  test('disconnect in lobby (host alone) schedules room deletion', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const room = await c1.createRoom('Alice', 2);
    await c1.close();

    // Room still exists during grace period
    await new Promise((r) => setTimeout(r, 100));
    const c2 = createClient(srv.url);
    await c2.connect();
    const tokenData = await c2.joinRoom(room.roomId, 'Bob');
    expect(tokenData.playerId).toBeDefined();

    await c2.close();
  });

  test('host disconnect with others transfers host', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    const bobToken = await c2.joinRoom(room.roomId, 'Bob');

    // Alice (host) disconnects
    const leftP = c2.waitFor('playerLeft');
    await c1.close();
    const left = await leftP;

    // Bob should now be host
    expect(left.gameState.hostPlayerId).toBe(bobToken.playerId);
    expect(left.gameState.players).toHaveLength(1);
    expect(left.gameState.players[0].name).toBe('Bob');

    await c2.close();
  });

  test('non-host cannot start game', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    // Bob (non-host) tries to start
    const errP = c2.waitForError();
    c2.emit('startGame');
    const err = await errP;

    expect(err.message).toBe('error.onlyHostCanStart');

    await c1.close();
    await c2.close();
  });
});
