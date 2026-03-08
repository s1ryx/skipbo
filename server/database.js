const Database = require('better-sqlite3');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, 'data', 'skipbo.db');

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      session_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = db.prepare('SELECT version FROM schema_version').get();
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
  }
}

function openDatabase(dbPath) {
  const resolvedPath = dbPath || DEFAULT_DB_PATH;
  const db = new Database(resolvedPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);

  return db;
}

module.exports = { openDatabase, DEFAULT_DB_PATH };
