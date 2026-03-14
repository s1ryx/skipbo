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

  test('disconnect in lobby (non-host) sends playerDisconnected', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    const dcP = c1.waitFor('playerDisconnected');
    await c2.close();
    const dc = await dcP;

    expect(dc.playerId).toBeDefined();

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

  test('host disconnect in lobby preserves host on reconnect', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    // Alice (host) disconnects
    const dcP = c2.waitFor('playerDisconnected');
    await c1.close();
    await dcP;

    // Alice reconnects — should still be host
    const c1b = createClient(srv.url);
    await c1b.connect();

    const reconnectP = c1b.waitFor('reconnected');
    c1b.emit('reconnect', {
      roomId: room.roomId,
      sessionToken: room.sessionToken,
      playerName: 'Alice',
    });
    const result = await reconnectP;

    expect(result.gameState.hostPlayerId).toBe(room.playerId);
    expect(result.gameState.players).toHaveLength(2);

    await c1b.close();
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
