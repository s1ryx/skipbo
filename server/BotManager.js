const crypto = require('crypto');
const { AIPlayer } = require('./ai/AIPlayer');
const { DIFFICULTY_PRESETS } = require('./ai/presets');
const { BOT_ID_PREFIX } = require('./config');

class BotManager {
  constructor() {
    this.botAIs = new Map(); // `${roomId}:${publicId}` → AIPlayer instance
    this.botTurnTimers = new Map(); // roomId → [timeoutId...]
  }

  createBot(roomId, game, aiType) {
    const validAiType = DIFFICULTY_PRESETS[aiType] ? aiType : 'improved';
    const botConnectionId = BOT_ID_PREFIX + crypto.randomUUID();
    const botNumber = game.players.filter((p) => p.isBot).length + 1;
    const botName = `Bot ${botNumber}`;

    const added = game.addPlayer(botConnectionId, botName);
    if (!added) return null;

    const botPlayer = game.players[game.players.length - 1];
    botPlayer.isBot = true;
    botPlayer.aiType = validAiType;

    const features = DIFFICULTY_PRESETS[validAiType];
    this.botAIs.set(`${roomId}:${botPlayer.publicId}`, new AIPlayer({ features }));

    return { botId: botConnectionId, botName, publicId: botPlayer.publicId, aiType: validAiType };
  }

  removeBot(roomId, game, botPublicId) {
    const botPlayer = game.players.find((p) => p.publicId === botPublicId);
    if (!botPlayer || !botPlayer.isBot) return false;

    game.removePlayer(botPlayer.internalId);
    this.botAIs.delete(`${roomId}:${botPublicId}`);
    return true;
  }

  getAI(roomId, publicId) {
    return this.botAIs.get(`${roomId}:${publicId}`);
  }

  scheduleTimer(roomId, callback, delay = 500) {
    const timerId = setTimeout(callback, delay);
    if (!this.botTurnTimers.has(roomId)) {
      this.botTurnTimers.set(roomId, []);
    }
    this.botTurnTimers.get(roomId).push(timerId);
  }

  clearTimers(roomId) {
    const timers = this.botTurnTimers.get(roomId);
    if (timers) {
      timers.forEach((id) => clearTimeout(id));
      this.botTurnTimers.delete(roomId);
    }
  }

  clearAIs(roomId) {
    for (const key of this.botAIs.keys()) {
      if (key.startsWith(roomId + ':')) {
        this.botAIs.delete(key);
      }
    }
  }

  cleanup(roomId) {
    this.clearTimers(roomId);
    this.clearAIs(roomId);
  }
}

module.exports = BotManager;
