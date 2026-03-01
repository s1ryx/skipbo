const crypto = require('crypto');

class SessionManager {
  constructor() {
    this.playerRooms = new Map(); // connectionId → roomId
  }

  generateToken() {
    return crypto.randomUUID();
  }

  getRoom(connectionId) {
    return this.playerRooms.get(connectionId);
  }

  setRoom(connectionId, roomId) {
    this.playerRooms.set(connectionId, roomId);
  }

  removeRoom(connectionId) {
    this.playerRooms.delete(connectionId);
  }

  hasRoom(connectionId) {
    return this.playerRooms.has(connectionId);
  }

  transferConnection(oldId, newId) {
    const roomId = this.playerRooms.get(oldId);
    if (roomId === undefined) return false;
    this.playerRooms.delete(oldId);
    this.playerRooms.set(newId, roomId);
    return true;
  }

  removeAllForPlayers(players) {
    for (const player of players) {
      this.playerRooms.delete(player.id);
    }
  }
}

module.exports = SessionManager;
