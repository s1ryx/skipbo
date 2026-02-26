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

describe('Chat', () => {
  test('message is broadcast to all players in room', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    const msg1P = c1.waitFor('chatMessage');
    const msg2P = c2.waitFor('chatMessage');

    c1.emit('sendChatMessage', { message: 'Hello!' });

    const [msg1, msg2] = await Promise.all([msg1P, msg2P]);

    expect(msg1.message).toBe('Hello!');
    expect(msg1.playerName).toBe('Alice');
    expect(msg1.stablePlayerId).toBeDefined();
    expect(msg1.timestamp).toBeDefined();

    expect(msg2.message).toBe('Hello!');
    expect(msg2.playerName).toBe('Alice');

    await c1.close();
    await c2.close();
  });

  test('stablePlayerId matches sender publicId', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    const msgP = c1.waitFor('chatMessage');
    c1.emit('sendChatMessage', { message: 'Test' });
    const msg = await msgP;

    // stablePlayerId should be the server-assigned publicId, not client-provided
    expect(msg.stablePlayerId).toBe(room.playerId);

    await c1.close();
    await c2.close();
  });

  test('silently drops empty chat message', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    // Send empty message — should be silently dropped
    c1.emit('sendChatMessage', { message: '' });

    // Send a valid message right after
    const msgP = c2.waitFor('chatMessage');
    c1.emit('sendChatMessage', { message: 'Real message' });
    const msg = await msgP;

    // Only the valid message should arrive
    expect(msg.message).toBe('Real message');

    await c1.close();
    await c2.close();
  });

  test('strips HTML from chat messages', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2);
    await c2.joinRoom(room.roomId, 'Bob');

    const msgP = c2.waitFor('chatMessage');
    c1.emit('sendChatMessage', { message: '<script>alert("xss")</script>Hello' });
    const msg = await msgP;

    expect(msg.message).not.toContain('<script>');
    expect(msg.message).toContain('Hello');

    await c1.close();
    await c2.close();
  });

  test('chat works during active game', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    const room = await c1.createRoom('Alice', 2, 5);
    await c2.joinRoom(room.roomId, 'Bob');
    await Promise.all([c1.startGame(), c2.waitFor('gameStarted')]);

    const msgP = c2.waitFor('chatMessage');
    c1.emit('sendChatMessage', { message: 'Good luck!' });
    const msg = await msgP;

    expect(msg.message).toBe('Good luck!');

    await c1.close();
    await c2.close();
  });
});
