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

  describe('scheduleDeletion / cancelDeletion', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('calls callback after delay', () => {
      const cb = jest.fn();
      repo.scheduleDeletion('ROOM01', cb, 5000);
      expect(cb).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('tracks pending deletion in map', () => {
      repo.scheduleDeletion('ROOM01', jest.fn(), 5000);
      expect(repo.pendingDeletions.has('ROOM01')).toBe(true);
    });

    it('removes from map after callback fires', () => {
      repo.scheduleDeletion('ROOM01', jest.fn(), 5000);
      jest.advanceTimersByTime(5000);
      expect(repo.pendingDeletions.has('ROOM01')).toBe(false);
    });

    it('cancelDeletion prevents callback and returns true', () => {
      const cb = jest.fn();
      repo.scheduleDeletion('ROOM01', cb, 5000);
      expect(repo.cancelDeletion('ROOM01')).toBe(true);
      jest.advanceTimersByTime(5000);
      expect(cb).not.toHaveBeenCalled();
      expect(repo.pendingDeletions.has('ROOM01')).toBe(false);
    });

    it('cancelDeletion returns false for unknown room', () => {
      expect(repo.cancelDeletion('NOPE')).toBe(false);
    });
  });

  describe('scheduleCompletedCleanup / cancelCompletedCleanup', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('calls callback after delay', () => {
      const cb = jest.fn();
      repo.scheduleCompletedCleanup('ROOM01', cb, 10000);
      expect(cb).not.toHaveBeenCalled();
      jest.advanceTimersByTime(10000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('tracks timer in map', () => {
      repo.scheduleCompletedCleanup('ROOM01', jest.fn(), 10000);
      expect(repo.completedGameTimers.has('ROOM01')).toBe(true);
    });

    it('removes from map after callback fires', () => {
      repo.scheduleCompletedCleanup('ROOM01', jest.fn(), 10000);
      jest.advanceTimersByTime(10000);
      expect(repo.completedGameTimers.has('ROOM01')).toBe(false);
    });

    it('cancelCompletedCleanup prevents callback and returns true', () => {
      const cb = jest.fn();
      repo.scheduleCompletedCleanup('ROOM01', cb, 10000);
      expect(repo.cancelCompletedCleanup('ROOM01')).toBe(true);
      jest.advanceTimersByTime(10000);
      expect(cb).not.toHaveBeenCalled();
      expect(repo.completedGameTimers.has('ROOM01')).toBe(false);
    });

    it('cancelCompletedCleanup returns false for unknown room', () => {
      expect(repo.cancelCompletedCleanup('NOPE')).toBe(false);
    });
  });
});
