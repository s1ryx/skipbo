class InMemoryPlayerStore {
  constructor() {
    this.players = new Map();
  }

  findByUsername(username) {
    return this.players.get(username.toLowerCase()) || null;
  }

  createPlayer(username, passwordHash) {
    const id = username.toLowerCase();
    const now = new Date().toISOString();
    const player = {
      id,
      display_name: username,
      password_hash: passwordHash || null,
      session_data: null,
      created_at: now,
      last_seen_at: now,
    };
    this.players.set(id, player);
    return { ...player };
  }

  touchLastSeen(username) {
    const player = this.players.get(username.toLowerCase());
    if (player) {
      player.last_seen_at = new Date().toISOString();
    }
  }

  setPassword(username, passwordHash) {
    const player = this.players.get(username.toLowerCase());
    if (player) {
      player.password_hash = passwordHash;
    }
  }

  setSessionData(username, sessionData) {
    const player = this.players.get(username.toLowerCase());
    if (player) {
      player.session_data = sessionData ? JSON.stringify(sessionData) : null;
    }
  }

  getSessionData(username) {
    const player = this.players.get(username.toLowerCase());
    if (!player || !player.session_data) return null;
    try {
      return JSON.parse(player.session_data);
    } catch {
      return null;
    }
  }

  clearSessionData(username) {
    const player = this.players.get(username.toLowerCase());
    if (player) {
      player.session_data = null;
    }
  }
}

module.exports = InMemoryPlayerStore;
