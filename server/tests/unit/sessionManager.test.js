const SessionManager = require('../../SessionManager');

describe('SessionManager', () => {
  let sm;

  beforeEach(() => {
    sm = new SessionManager();
  });

  describe('generateToken', () => {
    it('returns a UUID string', () => {
      const token = sm.generateToken();
      expect(typeof token).toBe('string');
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('returns unique tokens', () => {
      const a = sm.generateToken();
      const b = sm.generateToken();
      expect(a).not.toBe(b);
    });
  });

  describe('getRoom / setRoom', () => {
    it('returns undefined for unknown connection', () => {
      expect(sm.getRoom('unknown')).toBeUndefined();
    });

    it('returns room after setRoom', () => {
      sm.setRoom('conn1', 'ROOM1');
      expect(sm.getRoom('conn1')).toBe('ROOM1');
    });

    it('overwrites previous room', () => {
      sm.setRoom('conn1', 'ROOM1');
      sm.setRoom('conn1', 'ROOM2');
      expect(sm.getRoom('conn1')).toBe('ROOM2');
    });
  });

  describe('removeRoom', () => {
    it('removes existing mapping', () => {
      sm.setRoom('conn1', 'ROOM1');
      sm.removeRoom('conn1');
      expect(sm.getRoom('conn1')).toBeUndefined();
    });

    it('is a no-op for unknown connection', () => {
      sm.removeRoom('unknown');
      expect(sm.getRoom('unknown')).toBeUndefined();
    });
  });

  describe('hasRoom', () => {
    it('returns false for unknown connection', () => {
      expect(sm.hasRoom('unknown')).toBe(false);
    });

    it('returns true after setRoom', () => {
      sm.setRoom('conn1', 'ROOM1');
      expect(sm.hasRoom('conn1')).toBe(true);
    });

    it('returns false after removeRoom', () => {
      sm.setRoom('conn1', 'ROOM1');
      sm.removeRoom('conn1');
      expect(sm.hasRoom('conn1')).toBe(false);
    });
  });

  describe('transferConnection', () => {
    it('moves room mapping from old to new ID', () => {
      sm.setRoom('old', 'ROOM1');
      expect(sm.transferConnection('old', 'new')).toBe(true);
      expect(sm.getRoom('old')).toBeUndefined();
      expect(sm.getRoom('new')).toBe('ROOM1');
    });

    it('returns false when old ID has no room', () => {
      expect(sm.transferConnection('unknown', 'new')).toBe(false);
    });
  });

  describe('removeAllForPlayers', () => {
    it('removes rooms for all given players', () => {
      sm.setRoom('p1', 'ROOM1');
      sm.setRoom('p2', 'ROOM1');
      sm.setRoom('p3', 'ROOM2');
      sm.removeAllForPlayers([{ connectionId: 'p1' }, { connectionId: 'p2' }]);
      expect(sm.getRoom('p1')).toBeUndefined();
      expect(sm.getRoom('p2')).toBeUndefined();
      expect(sm.getRoom('p3')).toBe('ROOM2');
    });

    it('handles empty array', () => {
      sm.setRoom('p1', 'ROOM1');
      sm.removeAllForPlayers([]);
      expect(sm.getRoom('p1')).toBe('ROOM1');
    });
  });
});
