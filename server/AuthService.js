const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

class AuthService {
  constructor(playerStore) {
    this.playerStore = playerStore;
  }

  /**
   * Login or auto-register.
   *
   * Flow:
   * 1. If username exists and has a password → require correct password
   * 2. If username exists and has no password → allow in
   * 3. If username does not exist → auto-create
   */
  login(username, password) {
    const existing = this.playerStore.findByUsername(username);

    if (existing) {
      if (existing.password_hash) {
        if (!password) {
          return { success: false, error: 'error.passwordRequired' };
        }
        if (!bcrypt.compareSync(password, existing.password_hash)) {
          return { success: false, error: 'error.wrongPassword' };
        }
      }

      this.playerStore.touchLastSeen(username);
      return { success: true, player: existing, hasPassword: !!existing.password_hash };
    }

    // New user: auto-register
    const hash = password ? bcrypt.hashSync(password, SALT_ROUNDS) : null;
    const player = this.playerStore.createPlayer(username, hash);
    return { success: true, player, hasPassword: !!hash, isNew: true };
  }
}

module.exports = AuthService;
