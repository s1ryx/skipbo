class PlayerStore {
  constructor(db) {
    this.db = db;
    this._prepareStatements();
  }

  _prepareStatements() {
    this.stmts = {
      findById: this.db.prepare('SELECT * FROM players WHERE id = ?'),
      insert: this.db.prepare(
        'INSERT INTO players (id, display_name, password_hash) VALUES (?, ?, ?)'
      ),
      updateLastSeen: this.db.prepare(
        "UPDATE players SET last_seen_at = datetime('now') WHERE id = ?"
      ),
      setPassword: this.db.prepare('UPDATE players SET password_hash = ? WHERE id = ?'),
      setSessionData: this.db.prepare('UPDATE players SET session_data = ? WHERE id = ?'),
    };
  }

  findByUsername(username) {
    return this.stmts.findById.get(username.toLowerCase()) || null;
  }

  createPlayer(username, passwordHash) {
    const id = username.toLowerCase();
    this.stmts.insert.run(id, username, passwordHash || null);
    return this.stmts.findById.get(id);
  }

  touchLastSeen(username) {
    this.stmts.updateLastSeen.run(username.toLowerCase());
  }

  setPassword(username, passwordHash) {
    this.stmts.setPassword.run(passwordHash, username.toLowerCase());
  }

  setSessionData(username, sessionData) {
    const json = sessionData ? JSON.stringify(sessionData) : null;
    this.stmts.setSessionData.run(json, username.toLowerCase());
  }

  getSessionData(username) {
    const player = this.findByUsername(username);
    if (!player || !player.session_data) return null;
    try {
      return JSON.parse(player.session_data);
    } catch {
      return null;
    }
  }

  clearSessionData(username) {
    this.stmts.setSessionData.run(null, username.toLowerCase());
  }
}

module.exports = PlayerStore;
