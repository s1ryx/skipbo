class PlayerStore {
  constructor(db) {
    this.db = db;
    this._prepareStatements();
  }

  _id(username) {
    return username.toLowerCase();
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
    return this.stmts.findById.get(this._id(username)) || null;
  }

  createPlayer(username, passwordHash) {
    const id = this._id(username);
    this.stmts.insert.run(id, username, passwordHash || null);
    return this.stmts.findById.get(id);
  }

  touchLastSeen(username) {
    this.stmts.updateLastSeen.run(this._id(username));
  }

  setPassword(username, passwordHash) {
    this.stmts.setPassword.run(passwordHash, this._id(username));
  }

  setSessionData(username, sessionData) {
    const json = sessionData ? JSON.stringify(sessionData) : null;
    this.stmts.setSessionData.run(json, this._id(username));
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
    this.stmts.setSessionData.run(null, this._id(username));
  }
}

module.exports = PlayerStore;
