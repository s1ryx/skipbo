const BotManager = require('../../BotManager');
const SkipBoGame = require('../../gameLogic');

describe('BotManager', () => {
  let bm;
  let game;

  beforeEach(() => {
    bm = new BotManager();
    game = new SkipBoGame('ROOM1', 4, null);
    game.addPlayer('human1', 'Alice');
  });

  describe('createBot', () => {
    it('creates a bot and returns its info', () => {
      const result = bm.createBot('ROOM1', game, 'improved');
      expect(result).not.toBeNull();
      expect(result.botName).toBe('Bot 1');
      expect(result.aiType).toBe('improved');
      expect(result.publicId).toBeTruthy();
      expect(game.players).toHaveLength(2);
    });

    it('defaults to improved AI for invalid type', () => {
      const result = bm.createBot('ROOM1', game, 'invalid');
      expect(result.aiType).toBe('improved');
    });

    it('creates baseline AI when requested', () => {
      const result = bm.createBot('ROOM1', game, 'baseline');
      expect(result.aiType).toBe('baseline');
    });

    it('numbers bots sequentially', () => {
      const bot1 = bm.createBot('ROOM1', game, 'improved');
      const bot2 = bm.createBot('ROOM1', game, 'improved');
      expect(bot1.botName).toBe('Bot 1');
      expect(bot2.botName).toBe('Bot 2');
    });

    it('returns null when room is full', () => {
      game.addPlayer('h2', 'Bob');
      bm.createBot('ROOM1', game, 'improved');
      bm.createBot('ROOM1', game, 'improved');
      const result = bm.createBot('ROOM1', game, 'improved');
      expect(result).toBeNull();
    });

    it('stores AI instance accessible via getAI', () => {
      const result = bm.createBot('ROOM1', game, 'improved');
      const ai = bm.getAI('ROOM1', result.publicId);
      expect(ai).toBeDefined();
      expect(typeof ai.findPlayableCard).toBe('function');
    });

    it('sets isBot and aiType on player object', () => {
      bm.createBot('ROOM1', game, 'baseline');
      const botPlayer = game.players[game.players.length - 1];
      expect(botPlayer.isBot).toBe(true);
      expect(botPlayer.aiType).toBe('baseline');
    });
  });

  describe('removeBot', () => {
    it('removes an existing bot', () => {
      const result = bm.createBot('ROOM1', game, 'improved');
      expect(bm.removeBot('ROOM1', game, result.publicId)).toBe(true);
      expect(game.players).toHaveLength(1);
    });

    it('returns false for non-existent player', () => {
      expect(bm.removeBot('ROOM1', game, 'nonexistent')).toBe(false);
    });

    it('returns false for human player', () => {
      const humanPublicId = game.players[0].publicId;
      expect(bm.removeBot('ROOM1', game, humanPublicId)).toBe(false);
    });

    it('cleans up AI instance', () => {
      const result = bm.createBot('ROOM1', game, 'improved');
      bm.removeBot('ROOM1', game, result.publicId);
      expect(bm.getAI('ROOM1', result.publicId)).toBeUndefined();
    });
  });

  describe('getAI', () => {
    it('returns undefined for unknown bot', () => {
      expect(bm.getAI('ROOM1', 'unknown')).toBeUndefined();
    });
  });

  describe('scheduleTimer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('calls callback after delay', () => {
      const cb = jest.fn();
      bm.scheduleTimer('ROOM1', cb, 500);
      expect(cb).not.toHaveBeenCalled();
      jest.advanceTimersByTime(500);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('defaults to 500ms delay', () => {
      const cb = jest.fn();
      bm.scheduleTimer('ROOM1', cb);
      jest.advanceTimersByTime(499);
      expect(cb).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('clearTimers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('cancels pending timers', () => {
      const cb = jest.fn();
      bm.scheduleTimer('ROOM1', cb, 500);
      bm.clearTimers('ROOM1');
      jest.advanceTimersByTime(1000);
      expect(cb).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown room', () => {
      bm.clearTimers('unknown');
    });
  });

  describe('clearAIs', () => {
    it('removes all AIs for a room', () => {
      const bot1 = bm.createBot('ROOM1', game, 'improved');
      const game2 = new SkipBoGame('ROOM2', 2, null);
      game2.addPlayer('h', 'H');
      const bot2 = bm.createBot('ROOM2', game2, 'improved');

      bm.clearAIs('ROOM1');
      expect(bm.getAI('ROOM1', bot1.publicId)).toBeUndefined();
      expect(bm.getAI('ROOM2', bot2.publicId)).toBeDefined();
    });
  });

  describe('cleanup', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('clears both timers and AIs', () => {
      const cb = jest.fn();
      const bot = bm.createBot('ROOM1', game, 'improved');
      bm.scheduleTimer('ROOM1', cb, 500);

      bm.cleanup('ROOM1');
      jest.advanceTimersByTime(1000);
      expect(cb).not.toHaveBeenCalled();
      expect(bm.getAI('ROOM1', bot.publicId)).toBeUndefined();
    });
  });
});
