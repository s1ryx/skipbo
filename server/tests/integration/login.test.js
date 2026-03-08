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

describe('Login', () => {
  test('auto-registers a new user and returns loggedIn', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const loginP = c1.waitFor('loggedIn');
    c1.emit('login', { username: 'Alice' });
    const result = await loginP;

    expect(result.username).toBe('Alice');
    expect(result.hasPassword).toBe(false);
    expect(result.sessionData).toBeNull();

    await c1.close();
  });

  test('rejects login with invalid username', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const failP = c1.waitFor('loginFailed');
    c1.emit('login', { username: '' });
    const result = await failP;

    expect(result.error).toBeDefined();

    await c1.close();
  });

  test('returns stored session data on login', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    // Login and create a room
    const loginP = c1.waitFor('loggedIn');
    c1.emit('login', { username: 'SessionUser' });
    await loginP;

    const room = await c1.createRoom('SessionUser', 2);
    expect(room.roomId).toBeDefined();

    await c1.close();

    // Login again from a "different device"
    const c2 = createClient(srv.url);
    await c2.connect();

    const login2P = c2.waitFor('loggedIn');
    c2.emit('login', { username: 'SessionUser' });
    const result = await login2P;

    expect(result.sessionData).not.toBeNull();
    expect(result.sessionData.roomId).toBe(room.roomId);
    expect(result.sessionData.sessionToken).toBeDefined();

    await c2.close();
  });

  test('session data is cleared after leaving lobby', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    const loginP = c1.waitFor('loggedIn');
    c1.emit('login', { username: 'LeaveUser' });
    await loginP;

    await c1.createRoom('LeaveUser', 2);
    c1.emit('leaveLobby');

    // Wait a moment for leave to process
    await new Promise((r) => setTimeout(r, 100));

    // Login again — session data should be cleared
    const c2 = createClient(srv.url);
    await c2.connect();

    const login2P = c2.waitFor('loggedIn');
    c2.emit('login', { username: 'LeaveUser' });
    const result = await login2P;

    expect(result.sessionData).toBeNull();

    await c1.close();
    await c2.close();
  });

  test('password-protected login works', async () => {
    const c1 = createClient(srv.url);
    await c1.connect();

    // Register with password
    const loginP = c1.waitFor('loggedIn');
    c1.emit('login', { username: 'SecureUser', password: 'secret123' });
    const reg = await loginP;
    expect(reg.hasPassword).toBe(true);
    await c1.close();

    // Login with correct password
    const c2 = createClient(srv.url);
    await c2.connect();
    const login2P = c2.waitFor('loggedIn');
    c2.emit('login', { username: 'SecureUser', password: 'secret123' });
    const success = await login2P;
    expect(success.username).toBe('SecureUser');
    await c2.close();

    // Login with wrong password
    const c3 = createClient(srv.url);
    await c3.connect();
    const failP = c3.waitFor('loginFailed');
    c3.emit('login', { username: 'SecureUser', password: 'wrong' });
    const fail = await failP;
    expect(fail.error).toBe('error.wrongPassword');
    await c3.close();

    // Login without password when one is set
    const c4 = createClient(srv.url);
    await c4.connect();
    const fail2P = c4.waitFor('loginFailed');
    c4.emit('login', { username: 'SecureUser' });
    const fail2 = await fail2P;
    expect(fail2.error).toBe('error.passwordRequired');
    await c4.close();
  });
});
