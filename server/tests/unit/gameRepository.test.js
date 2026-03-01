const GameRepository = require('../../GameRepository');

describe('GameRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new GameRepository();
  });

  describe('saveGame / getGame', () => {
    it('stores and retrieves a game by roomId', () => {
      const game = { roomId: 'ROOM01' };
      repo.saveGame('ROOM01', game);
      expect(repo.getGame('ROOM01')).toBe(game);
    });

    it('returns undefined for unknown roomId', () => {
      expect(repo.getGame('NOPE')).toBeUndefined();
    });

    it('overwrites an existing game', () => {
      repo.saveGame('ROOM01', { v: 1 });
      repo.saveGame('ROOM01', { v: 2 });
      expect(repo.getGame('ROOM01')).toEqual({ v: 2 });
    });
  });

  describe('deleteGame', () => {
    it('removes a stored game', () => {
      repo.saveGame('ROOM01', {});
      repo.deleteGame('ROOM01');
      expect(repo.getGame('ROOM01')).toBeUndefined();
    });

    it('is a no-op for unknown roomId', () => {
      repo.deleteGame('NOPE'); // should not throw
    });
  });

  describe('hasGame', () => {
    it('returns true for stored game', () => {
      repo.saveGame('ROOM01', {});
      expect(repo.hasGame('ROOM01')).toBe(true);
    });

    it('returns false for unknown roomId', () => {
      expect(repo.hasGame('NOPE')).toBe(false);
    });
  });

  describe('size', () => {
    it('returns 0 for empty repository', () => {
      expect(repo.size).toBe(0);
    });

    it('reflects the number of stored games', () => {
      repo.saveGame('A', {});
      repo.saveGame('B', {});
      expect(repo.size).toBe(2);
    });

    it('decrements after deletion', () => {
      repo.saveGame('A', {});
      repo.deleteGame('A');
      expect(repo.size).toBe(0);
    });
  });

  describe('getAllRoomIds', () => {
    it('returns empty array for empty repository', () => {
      expect(repo.getAllRoomIds()).toEqual([]);
    });

    it('returns all stored room IDs', () => {
      repo.saveGame('A', {});
      repo.saveGame('B', {});
      expect(repo.getAllRoomIds().sort()).toEqual(['A', 'B']);
    });
  });
});
