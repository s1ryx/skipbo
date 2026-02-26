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

describe('Room creation', () => {
  test('creates a room and returns expected data', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const result = await c.createRoom('Alice', 2);

    expect(result).toMatchObject({
      roomId: expect.stringMatching(/^[A-Z0-9]{6}$/),
      playerId: expect.any(String),
      sessionToken: expect.any(String),
      gameState: expect.objectContaining({
        players: expect.any(Array),
        buildingPiles: expect.any(Array),
        gameStarted: false,
        gameOver: false,
        hostPlayerId: expect.any(String),
      }),
    });
    expect(result.gameState.players).toHaveLength(1);
    expect(result.gameState.players[0].name).toBe('Alice');

    await c.close();
  });

  test('defaults maxPlayers to 2 for invalid values', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const result = await c.createRoom('Alice');
    // Default 2 players, so joining a third should fail
    const c2 = createClient(srv.url);
    await c2.connect();
    await c2.joinRoom(result.roomId, 'Bob');

    const c3 = createClient(srv.url);
    await c3.connect();
    const errPromise = c3.waitForError();
    c3.emit('joinRoom', { roomId: result.roomId, playerName: 'Charlie' });
    const err = await errPromise;
    expect(err.message).toBe('error.roomFull');

    await c.close();
    await c2.close();
    await c3.close();
  });

  test('clamps stockpileSize to valid range', async () => {
    const c = createClient(srv.url);
    await c.connect();

    // stockpileSize of 100 should be clamped to default
    const result = await c.createRoom('Alice', 2, 100);
    expect(result.gameState).toBeDefined();

    await c.close();
  });
});

describe('Room joining', () => {
  test('second player receives sessionToken and playerJoined', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    const joinedPromise = c1.waitFor('playerJoined');
    const tokenData = await c2.joinRoom(room.roomId, 'Bob');
    const joined = await joinedPromise;

    expect(tokenData).toMatchObject({
      playerId: expect.any(String),
      sessionToken: expect.any(String),
    });
    expect(joined.gameState.players).toHaveLength(2);
    expect(joined.playerName).toBe('Bob');

    await c1.close();
    await c2.close();
  });

  test('joining non-existent room returns error', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const errPromise = c.waitForError();
    c.emit('joinRoom', { roomId: 'XXXXXX', playerName: 'Bob' });
    const err = await errPromise;
    expect(err.message).toBe('error.roomNotFound');

    await c.close();
  });

  test('joining full room returns error', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    const c3 = createClient(srv.url);
    await c1.connect();
    await c2.connect();
    await c3.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    const errPromise = c3.waitForError();
    c3.emit('joinRoom', { roomId: room.roomId, playerName: 'Charlie' });
    const err = await errPromise;
    expect(err.message).toBe('error.roomFull');

    await c1.close();
    await c2.close();
    await c3.close();
  });
});

describe('Leaving lobby', () => {
  test('creator leaving alone schedules room for deletion', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const room = await c1.createRoom('Alice', 2);
    c1.emit('leaveLobby');

    // Room has a 30s grace period — during that time a new player can join
    await new Promise((r) => setTimeout(r, 100));

    const c2 = createClient(srv.url);
    await c2.connect();
    const tokenData = await c2.joinRoom(room.roomId, 'Bob');
    expect(tokenData.playerId).toBeDefined();

    await c1.close();
    await c2.close();
  });

  test('non-creator leaving keeps room alive', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    const leftPromise = c1.waitFor('playerLeft');
    c2.emit('leaveLobby');
    const left = await leftPromise;

    expect(left.gameState.players).toHaveLength(1);
    expect(left.gameState.players[0].name).toBe('Alice');

    // Room still exists — a new player can join
    const c3 = createClient(srv.url);
    await c3.connect();
    await c3.joinRoom(room.roomId, 'Charlie');

    await c1.close();
    await c2.close();
    await c3.close();
  });
});

describe('Player name validation', () => {
  test('rejects empty name', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const errPromise = c.waitForError();
    c.emit('createRoom', { playerName: '', maxPlayers: 2, stockpileSize: null });
    const err = await errPromise;
    expect(err.message).toBe('error.invalidPlayerName');

    await c.close();
  });

  test('rejects non-string name', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const errPromise = c.waitForError();
    c.emit('createRoom', { playerName: 123, maxPlayers: 2, stockpileSize: null });
    const err = await errPromise;
    expect(err.message).toBe('error.invalidPlayerName');

    await c.close();
  });

  test('rejects name longer than 30 chars', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const errPromise = c.waitForError();
    c.emit('createRoom', { playerName: 'A'.repeat(31), maxPlayers: 2, stockpileSize: null });
    const err = await errPromise;
    expect(err.message).toBe('error.invalidPlayerName');

    await c.close();
  });

  test('strips HTML from names', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const result = await c.createRoom('<b>Alice</b>', 2);
    expect(result.gameState.players[0].name).toBe('Alice');

    await c.close();
  });

  test('strips control characters from names', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const result = await c.createRoom('Al\x00ice\x1F', 2);
    expect(result.gameState.players[0].name).toBe('Alice');

    await c.close();
  });
});

describe('Multiple rooms', () => {
  test('rooms are independent', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room1 = await c1.createRoom('Alice', 2);
    const room2 = await c2.createRoom('Bob', 2);

    expect(room1.roomId).not.toBe(room2.roomId);
    expect(room1.gameState.players).toHaveLength(1);
    expect(room2.gameState.players).toHaveLength(1);

    await c1.close();
    await c2.close();
  });
});
