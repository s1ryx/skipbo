const { openDatabase } = require('../../database');
const PlayerStore = require('../../PlayerStore');
const InMemoryPlayerStore = require('../../InMemoryPlayerStore');

function createSqliteStore() {
  const db = openDatabase(':memory:');
  return { store: new PlayerStore(db), cleanup: () => db.close() };
}

function createInMemoryStore() {
  return { store: new InMemoryPlayerStore(), cleanup: () => {} };
}

describe.each([
  ['PlayerStore (SQLite)', createSqliteStore],
  ['InMemoryPlayerStore', createInMemoryStore],
])('%s', (_name, factory) => {
  let store;
  let cleanup;

  beforeEach(() => {
    ({ store, cleanup } = factory());
  });

  afterEach(() => {
    cleanup();
  });

  describe('createPlayer and findByUsername', () => {
    it('creates a new player and retrieves it', () => {
      const player = store.createPlayer('Alice', null);
      expect(player.id).toBe('alice');
      expect(player.display_name).toBe('Alice');
      expect(player.password_hash).toBeNull();

      const found = store.findByUsername('Alice');
      expect(found.id).toBe('alice');
    });

    it('stores password hash when provided', () => {
      store.createPlayer('Bob', '$2a$10$fakehash');
      const found = store.findByUsername('bob');
      expect(found.password_hash).toBe('$2a$10$fakehash');
    });

    it('returns null for non-existent username', () => {
      expect(store.findByUsername('nobody')).toBeNull();
    });

    it('is case-insensitive for lookup', () => {
      store.createPlayer('Alice', null);
      expect(store.findByUsername('ALICE')).not.toBeNull();
      expect(store.findByUsername('alice')).not.toBeNull();
    });
  });

  describe('session data', () => {
    it('stores and retrieves session data as JSON', () => {
      store.createPlayer('Alice', null);
      const data = { roomId: 'ABC123', sessionToken: 'tok-1' };
      store.setSessionData('Alice', data);

      const result = store.getSessionData('Alice');
      expect(result).toEqual(data);
    });

    it('returns null when no session data is set', () => {
      store.createPlayer('Alice', null);
      expect(store.getSessionData('Alice')).toBeNull();
    });

    it('clears session data', () => {
      store.createPlayer('Alice', null);
      store.setSessionData('Alice', { roomId: 'X' });
      store.clearSessionData('Alice');
      expect(store.getSessionData('Alice')).toBeNull();
    });

    it('returns null for non-existent user', () => {
      expect(store.getSessionData('nobody')).toBeNull();
    });
  });

  describe('setPassword', () => {
    it('updates the password hash', () => {
      store.createPlayer('Alice', null);
      store.setPassword('Alice', '$2a$10$newhash');
      const found = store.findByUsername('Alice');
      expect(found.password_hash).toBe('$2a$10$newhash');
    });
  });

  describe('touchLastSeen', () => {
    it('updates last_seen_at without error', () => {
      store.createPlayer('Alice', null);
      expect(() => store.touchLastSeen('Alice')).not.toThrow();
    });
  });
});
