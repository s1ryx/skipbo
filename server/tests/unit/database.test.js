const { openDatabase } = require('../../database');

describe('openDatabase', () => {
  let db;

  afterEach(() => {
    if (db) db.close();
  });

  it('creates players table', () => {
    db = openDatabase(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toContain('players');
  });

  it('creates schema_version table with version 1', () => {
    db = openDatabase(':memory:');
    const row = db.prepare('SELECT version FROM schema_version').get();
    expect(row.version).toBe(1);
  });

  it('enables WAL journal mode on file-backed databases', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpFile = path.join(os.tmpdir(), `skipbo-test-${Date.now()}.db`);
    try {
      db = openDatabase(tmpFile);
      const { journal_mode } = db.prepare('PRAGMA journal_mode').get();
      expect(journal_mode).toBe('wal');
      db.close();
      db = null;
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(tmpFile + suffix);
        } catch {}
      }
    }
  });

  it('enables foreign keys', () => {
    db = openDatabase(':memory:');
    const { foreign_keys } = db.prepare('PRAGMA foreign_keys').get();
    expect(foreign_keys).toBe(1);
  });

  it('is idempotent on repeated calls', () => {
    db = openDatabase(':memory:');
    expect(() => openDatabase(':memory:')).not.toThrow();
  });
});
