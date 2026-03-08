const bcrypt = require('bcryptjs');
const AuthService = require('../../AuthService');
const InMemoryPlayerStore = require('../../InMemoryPlayerStore');

describe('AuthService', () => {
  let store;
  let auth;

  beforeEach(() => {
    store = new InMemoryPlayerStore();
    auth = new AuthService(store);
  });

  describe('auto-registration', () => {
    it('creates a new account for unknown username', () => {
      const result = auth.login('Alice', null);
      expect(result.success).toBe(true);
      expect(result.isNew).toBe(true);
      expect(result.player.id).toBe('alice');
    });

    it('stores password hash when password provided on registration', () => {
      const result = auth.login('Alice', 'secret123');
      expect(result.success).toBe(true);
      expect(result.hasPassword).toBe(true);
      const found = store.findByUsername('alice');
      expect(bcrypt.compareSync('secret123', found.password_hash)).toBe(true);
    });

    it('creates passwordless account when no password provided', () => {
      const result = auth.login('Alice', null);
      expect(result.hasPassword).toBe(false);
    });
  });

  describe('passwordless login', () => {
    it('allows login to account without password', () => {
      auth.login('Alice', null);
      const result = auth.login('Alice', null);
      expect(result.success).toBe(true);
      expect(result.isNew).toBeUndefined();
    });
  });

  describe('password-protected login', () => {
    it('succeeds with correct password', () => {
      auth.login('Alice', 'secret123');
      const result = auth.login('Alice', 'secret123');
      expect(result.success).toBe(true);
      expect(result.hasPassword).toBe(true);
    });

    it('fails with wrong password', () => {
      auth.login('Alice', 'secret123');
      const result = auth.login('Alice', 'wrongpass');
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.wrongPassword');
    });

    it('fails when no password provided for protected account', () => {
      auth.login('Alice', 'secret123');
      const result = auth.login('Alice', null);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.passwordRequired');
    });
  });
});
