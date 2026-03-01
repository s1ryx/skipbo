class GameRepository {
  constructor() {
    this.games = new Map();
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
}

module.exports = GameRepository;
