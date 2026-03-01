class GameRepository {
  constructor() {
    this.games = new Map();
    this.pendingDeletions = new Map();
    this.completedGameTimers = new Map();
  }

  getGame(roomId) {
    return this.games.get(roomId);
  }

  saveGame(roomId, game) {
    this.games.set(roomId, game);
  }

  deleteGame(roomId) {
    this.games.delete(roomId);
  }

  hasGame(roomId) {
    return this.games.has(roomId);
  }

  get size() {
    return this.games.size;
  }

  getAllRoomIds() {
    return [...this.games.keys()];
  }

  scheduleDeletion(roomId, callback, delay) {
    const timeoutId = setTimeout(() => {
      this.pendingDeletions.delete(roomId);
      callback();
    }, delay);
    this.pendingDeletions.set(roomId, timeoutId);
  }

  cancelDeletion(roomId) {
    const timeoutId = this.pendingDeletions.get(roomId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pendingDeletions.delete(roomId);
      return true;
    }
    return false;
  }

  scheduleCompletedCleanup(roomId, callback, delay) {
    const timeoutId = setTimeout(() => {
      this.completedGameTimers.delete(roomId);
      callback();
    }, delay);
    this.completedGameTimers.set(roomId, timeoutId);
  }

  cancelCompletedCleanup(roomId) {
    const timeoutId = this.completedGameTimers.get(roomId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.completedGameTimers.delete(roomId);
      return true;
    }
    return false;
  }
}

module.exports = GameRepository;
