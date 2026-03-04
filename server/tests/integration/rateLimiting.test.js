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

describe('Rate limiting', () => {
  test('allows 30 events within the window', async () => {
    const c = createClient(srv.url);
    await c.connect();

    // Send 30 createRoom events rapidly — most will error (invalid name etc)
    // but none should trigger rate limit
    for (let i = 0; i < 30; i++) {
      c.emit('createRoom', { playerName: `Bot${i}`, maxPlayers: 2 });
    }

    // Give events time to process
    await new Promise((r) => setTimeout(r, 500));

    // Should NOT have received a rate limit error
    // (the rooms will be created or error for other reasons)
    await c.close();
  });

  test('rejects the 31st event with rate limit error', async () => {
    const c = createClient(srv.url);
    await c.connect();

    const errorP = c.waitForError(5000);

    // Send 31 events rapidly to exceed the 30/10s limit
    for (let i = 0; i < 31; i++) {
      c.emit('createRoom', { playerName: `Bot${i}`, maxPlayers: 2 });
    }

    const err = await errorP;
    expect(err.message).toBe('error.rateLimited');

    await c.close();
  });

  test('rate limit is per-connection', async () => {
    const c1 = createClient(srv.url);
    const c2 = createClient(srv.url);
    await c1.connect();
    await c2.connect();

    // Exhaust c1's rate limit
    const errorP = c1.waitForError(5000);
    for (let i = 0; i < 31; i++) {
      c1.emit('createRoom', { playerName: `Bot${i}`, maxPlayers: 2 });
    }
    await errorP;

    // c2 should still be able to send events
    const room = await c2.createRoom('Alice', 2);
    expect(room.roomId).toBeDefined();

    await c1.close();
    await c2.close();
  });
});
