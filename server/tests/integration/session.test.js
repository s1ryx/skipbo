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

describe('Session and reconnection', () => {
  test('reconnect with valid token restores state in lobby', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const room = await c1.createRoom('Alice', 2);
    const { sessionToken, roomId } = room;

    // Disconnect
    await c1.close();

    // Reconnect with new client
    const c1b = createClient(srv.url);
    await c1b.connect();

    const reconnectP = c1b.waitFor('reconnected');
    c1b.emit('reconnect', { roomId, sessionToken, playerName: 'Alice' });
    const result = await reconnectP;

    expect(result.roomId).toBe(roomId);
    expect(result.playerId).toBeDefined();
    expect(result.sessionToken).toBeDefined();
    expect(result.gameState).toBeDefined();
    expect(result.gameState.players).toHaveLength(1);

    await c1b.close();
  });

  test('reconnect with wrong token in active game fails', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    await c2.joinRoom(room.roomId, 'Bob');
    await Promise.all([c1.startGame(), c2.waitFor('gameStarted')]);

    // Disconnect Alice
    await c1.close();
    await new Promise((r) => setTimeout(r, 100));

    const c1b = createClient(srv.url);
    await c1b.connect();

    const failP = c1b.waitFor('reconnectFailed');
    c1b.emit('reconnect', {
      roomId: room.roomId,
      sessionToken: 'wrong-token-12345',
      playerName: 'Alice',
    });
    const result = await failP;

    expect(result.message).toBe('error.playerNotFound');

    await c1b.close();
    await c2.close();
  });

  test('reconnect to non-existent room fails', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const failP = c1.waitFor('reconnectFailed');
    c1.emit('reconnect', {
      roomId: 'ZZZZZZ',
      sessionToken: 'some-token',
      playerName: 'Alice',
    });
    const result = await failP;

    expect(result.message).toBe('error.roomNoLongerExists');

    await c1.close();
  });

  test('reconnect mid-game restores full game state', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    const tokenData = await c2.joinRoom(room.roomId, 'Bob');

    // Start game
    const [s1] = await Promise.all([
      c1.startGame(),
      c2.waitFor('gameStarted'),
    ]);

    // Disconnect c1 (Alice)
    const disconnectP = c2.waitFor('playerDisconnected');
    await c1.close();
    await disconnectP;

    // Reconnect as Alice
    const c1b = createClient(srv.url);
    await c1b.connect();

    const reconnectP = c1b.waitFor('reconnected');
    c1b.emit('reconnect', {
      roomId: room.roomId,
      sessionToken: room.sessionToken,
      playerName: 'Alice',
    });
    const result = await reconnectP;

    expect(result.gameState.gameStarted).toBe(true);
    expect(result.playerState).toBeDefined();
    expect(result.playerState.hand).toBeInstanceOf(Array);
    expect(result.playerState.hand.length).toBeGreaterThan(0);

    await c1b.close();
    await c2.close();
  });

  test('other players see disconnect then reconnect events', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    const bobTokenData = await c2.joinRoom(room.roomId, 'Bob');

    await Promise.all([c1.startGame(), c2.waitFor('gameStarted')]);

    // Bob disconnects — Alice should see playerDisconnected
    const disconnectP = c1.waitFor('playerDisconnected');
    await c2.close();
    const disconnectEvt = await disconnectP;

    expect(disconnectEvt.playerId).toBe(bobTokenData.playerId);

    // Bob reconnects — Alice should see playerReconnected
    const reconnectP = c1.waitFor('playerReconnected');
    const c2b = createClient(srv.url);
    await c2b.connect();

    const bobReconnectP = c2b.waitFor('reconnected');
    c2b.emit('reconnect', {
      roomId: room.roomId,
      sessionToken: bobTokenData.sessionToken,
      playerName: 'Bob',
    });
    await bobReconnectP;

    const reconnectEvt = await reconnectP;
    expect(reconnectEvt.playerId).toBe(bobTokenData.playerId);

    await c1.close();
    await c2b.close();
  });

  test('reconnected player gets a new session token', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const room = await c1.createRoom('Alice', 2);
    const originalToken = room.sessionToken;

    await c1.close();

    const c1b = createClient(srv.url);
    await c1b.connect();

    const reconnectP = c1b.waitFor('reconnected');
    c1b.emit('reconnect', {
      roomId: room.roomId,
      sessionToken: originalToken,
      playerName: 'Alice',
    });
    const result = await reconnectP;

    expect(result.sessionToken).toBeDefined();
    expect(result.sessionToken).not.toBe(originalToken);

    await c1b.close();
  });

  test('multiple disconnect/reconnect cycles', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const room = await c1.createRoom('Alice', 2);
    let token = room.sessionToken;

    // Cycle 1
    await c1.close();
    const c1b = createClient(srv.url);
    await c1b.connect();
    let reconnectP = c1b.waitFor('reconnected');
    c1b.emit('reconnect', { roomId: room.roomId, sessionToken: token, playerName: 'Alice' });
    let result = await reconnectP;
    token = result.sessionToken;

    // Cycle 2
    await c1b.close();
    const c1c = createClient(srv.url);
    await c1c.connect();
    reconnectP = c1c.waitFor('reconnected');
    c1c.emit('reconnect', { roomId: room.roomId, sessionToken: token, playerName: 'Alice' });
    result = await reconnectP;
    token = result.sessionToken;

    // Cycle 3
    await c1c.close();
    const c1d = createClient(srv.url);
    await c1d.connect();
    reconnectP = c1d.waitFor('reconnected');
    c1d.emit('reconnect', { roomId: room.roomId, sessionToken: token, playerName: 'Alice' });
    result = await reconnectP;

    expect(result.gameState.players).toHaveLength(1);
    expect(result.gameState.players[0].name).toBe('Alice');

    await c1d.close();
  });

  test('disconnect and reconnect during game preserves publicId', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    await c2.joinRoom(room.roomId, 'Bob');

    const [started] = await Promise.all([
      c1.startGame(),
      c2.waitFor('gameStarted'),
    ]);

    const originalAliceId = room.playerId;

    // Disconnect and reconnect Alice
    await c1.close();
    await new Promise((r) => setTimeout(r, 100));

    const c1b = createClient(srv.url);
    await c1b.connect();

    const reconnectP = c1b.waitFor('reconnected');
    c1b.emit('reconnect', {
      roomId: room.roomId,
      sessionToken: room.sessionToken,
      playerName: 'Alice',
    });
    const result = await reconnectP;

    // publicId should be preserved
    expect(result.playerId).toBe(originalAliceId);

    await c1b.close();
    await c2.close();
  });
});
