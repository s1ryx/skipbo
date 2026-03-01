const crypto = require('crypto');
const SkipBoGame = require('./gameLogic');
const SessionManager = require('./SessionManager');
const BotManager = require('./BotManager');
const GameRepository = require('./GameRepository');
const { GameLogger, MoveAnalyzer } = require('./ai/GameLogger');
const { createLogger } = require('./logger');
const {
  LOBBY_GRACE_PERIOD_MS,
  MAX_PENDING_ROOMS,
  MAX_TOTAL_ROOMS,
  COMPLETED_GAME_TTL_MS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_STOCKPILE_SIZE,
  MAX_STOCKPILE_SIZE,
  MAX_PLAYER_NAME_LENGTH,
  MAX_CHAT_MESSAGE_LENGTH,
  BOT_ID_PREFIX,
  Phase,
} = require('./config');
const { ErrorCodes } = require('./errors');

function isBotId(id) {
  return typeof id === 'string' && id.startsWith(BOT_ID_PREFIX);
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '');
}

function sanitizeForLog(str) {
  return str.replace(/[\r\n]/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

function validatePlayerName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = stripHtml(name.trim()).replace(/[\x00-\x1F]/g, '');
  if (trimmed.length === 0 || trimmed.length > MAX_PLAYER_NAME_LENGTH) return null;
  return trimmed;
}

class GameCoordinator {
  constructor(options = {}) {
    this.transport = null;
    this.logger = options.logger || createLogger();
    this.gameRepository = new GameRepository();
    this.sessionManager = new SessionManager();
    this.botManager = new BotManager();

    // Game logging
    this.loggingEnabled = options.logging ?? false;
    this.logAnalysis = options.logAnalysis ?? false;
    this.gameLoggers = new Map();   // roomId → GameLogger
    this.turnCounters = new Map();  // roomId → { turn, plays, playerName, isBot }
    this.moveAnalyzer = this.logAnalysis ? new MoveAnalyzer() : null;
  }

  get games() {
    return this.gameRepository.games;
  }

  get pendingDeletions() {
    return this.gameRepository.pendingDeletions;
  }

  get completedGameTimers() {
    return this.gameRepository.completedGameTimers;
  }

  setTransport(transport) {
    this.transport = transport;
  }

  getTransportHandlers() {
    return {
      onConnect: (connectionId) => this.handleConnect(connectionId),
      onDisconnect: (connectionId) => this.handleDisconnect(connectionId),
      onMessage: (connectionId, event, data) => this.handleMessage(connectionId, event, data),
    };
  }

  handleConnect(connectionId) {
    this.logger.debug('player connected', { connectionId });
  }

  handleMessage(connectionId, event, data) {
    switch (event) {
      case 'createRoom':
        return this.handleCreateRoom(connectionId, data);
      case 'joinRoom':
        return this.handleJoinRoom(connectionId, data);
      case 'reconnect':
        return this.handleReconnect(connectionId, data);
      case 'startGame':
        return this.handleStartGame(connectionId);
      case 'playCard':
        return this.handlePlayCard(connectionId, data);
      case 'discardCard':
        return this.handleDiscardCard(connectionId, data);
      case 'sendChatMessage':
        return this.handleSendChatMessage(connectionId, data);
      case 'leaveLobby':
        return this.handleLeaveLobby(connectionId);
      case 'leaveGame':
        return this.handleLeaveGame(connectionId);
      case 'requestRematch':
        return this.handleRequestRematch(connectionId);
      case 'updateRematchSettings':
        return this.handleUpdateRematchSettings(connectionId, data);
      case 'addBot':
        return this.handleAddBot(connectionId, data);
      case 'removeBot':
        return this.handleRemoveBot(connectionId, data);
      default:
        this.logger.warn('unknown event', { event });
    }
  }

  handleCreateRoom(connectionId, { playerName, maxPlayers, stockpileSize, isBot }) {
    const validName = validatePlayerName(playerName);
    if (!validName) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.INVALID_PLAYER_NAME });
      return;
    }

    if (this.gameRepository.size >= MAX_TOTAL_ROOMS) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.SERVER_FULL });
      return;
    }

    const validMaxPlayers = Number.isInteger(maxPlayers) && maxPlayers >= MIN_PLAYERS && maxPlayers <= MAX_PLAYERS
      ? maxPlayers
      : MIN_PLAYERS;
    const validStockpileSize = Number.isInteger(stockpileSize) && stockpileSize >= MIN_STOCKPILE_SIZE && stockpileSize <= MAX_STOCKPILE_SIZE
      ? stockpileSize
      : undefined;

    const roomId = generateRoomId(this.gameRepository);
    if (!roomId) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.SERVER_FULL });
      return;
    }
    const game = new SkipBoGame(roomId, validMaxPlayers, validStockpileSize);
    game.addPlayer(connectionId, validName);

    const player = game.getPlayerByConnectionId(connectionId);
    const sessionToken = this.sessionManager.generateToken();
    game.setSessionToken(player.internalId, sessionToken);
    player.isBot = !!isBot;
    game.setHost(player.publicId);

    this.gameRepository.saveGame(roomId, game);
    this.sessionManager.setRoom(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'roomCreated', {
      roomId,
      playerId: player.publicId,
      sessionToken,
      gameState: this._getDecoratedGameState(game),
    });

    this.logger.info('room created', { roomId, playerName: sanitizeForLog(validName) });
  }

  handleJoinRoom(connectionId, { roomId, playerName, isBot }) {
    const validName = validatePlayerName(playerName);
    if (!validName) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.INVALID_PLAYER_NAME });
      return;
    }

    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_NOT_FOUND });
      return;
    }

    this.cancelPendingDeletion(roomId);

    if (game.phase !== Phase.LOBBY) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.GAME_ALREADY_STARTED });
      return;
    }

    const added = game.addPlayer(connectionId, validName);

    if (!added) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_FULL });
      return;
    }

    const player = game.getPlayerByConnectionId(connectionId);
    const sessionToken = this.sessionManager.generateToken();
    game.setSessionToken(player.internalId, sessionToken);
    player.isBot = !!isBot;

    this.sessionManager.setRoom(connectionId, roomId);
    this.transport.addToGroup(connectionId, roomId);

    this.transport.sendToGroup(roomId, 'playerJoined', {
      playerId: player.publicId,
      playerName: validName,
      gameState: this._getDecoratedGameState(game),
    });

    this.transport.send(connectionId, 'sessionToken', {
      playerId: player.publicId,
      sessionToken,
    });

    this.logger.info('player joined room', { roomId, playerName: sanitizeForLog(validName) });
  }

  handleReconnect(connectionId, { roomId, sessionToken, playerName }) {
    const validName = validatePlayerName(playerName);
    if (!validName) {
      this.transport.send(connectionId, 'reconnectFailed', {
        message: ErrorCodes.INVALID_PLAYER_NAME,
      });
      return;
    }

    if (!sessionToken || typeof sessionToken !== 'string') {
      this.transport.send(connectionId, 'reconnectFailed', {
        message: ErrorCodes.INVALID_SESSION,
      });
      return;
    }

    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.transport.send(connectionId, 'reconnectFailed', {
        message: ErrorCodes.ROOM_NO_LONGER_EXISTS,
      });
      return;
    }

    this.cancelPendingDeletion(roomId);

    const player = game.players.find((p) => p.sessionToken === sessionToken);

    if (!player) {
      // Player was removed — rejoin if game hasn't started
      if (game.phase === Phase.LOBBY) {
        const added = game.addPlayer(connectionId, validName);
        if (!added) {
          this.transport.send(connectionId, 'reconnectFailed', { message: ErrorCodes.ROOM_FULL });
          return;
        }

        const newPlayer = game.getPlayerByConnectionId(connectionId);
        const newToken = this.sessionManager.generateToken();
        game.setSessionToken(newPlayer.internalId, newToken);

        this.sessionManager.setRoom(connectionId, roomId);
        this.transport.addToGroup(connectionId, roomId);

        this.transport.send(connectionId, 'reconnected', {
          roomId,
          playerId: newPlayer.publicId,
          sessionToken: newToken,
          gameState: this._getDecoratedGameState(game),
          playerState: game.getPlayerState(newPlayer.internalId),
        });

        this.transport.sendToGroupExcept(roomId, connectionId, 'playerJoined', {
          playerId: newPlayer.publicId,
          playerName: validName,
          gameState: this._getDecoratedGameState(game),
        });

        this.logger.info('player rejoined lobby', { roomId, playerName: sanitizeForLog(validName) });
        return;
      }

      this.transport.send(connectionId, 'reconnectFailed', { message: ErrorCodes.PLAYER_NOT_FOUND });
      return;
    }

    // Update player's connection ID and issue new session token
    const oldConnectionId = player.connectionId;
    game.updateConnectionId(player.internalId, connectionId);
    const newToken = this.sessionManager.generateToken();
    game.setSessionToken(player.internalId, newToken);

    game.removeRematchVote(player.internalId);

    this.sessionManager.removeRoom(oldConnectionId);
    this.sessionManager.setRoom(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'reconnected', {
      roomId,
      playerId: player.publicId,
      sessionToken: newToken,
      gameState: this._getDecoratedGameState(game),
      playerState: game.getPlayerState(player.internalId),
    });

    this.transport.sendToGroupExcept(roomId, connectionId, 'playerReconnected', {
      playerId: player.publicId,
      playerName: player.name,
    });

    this.logger.info('player reconnected', { roomId, playerName: sanitizeForLog(validName) });
  }

  handleStartGame(connectionId) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_NOT_FOUND });
      return;
    }

    const sender = game.getPlayerByConnectionId(connectionId);
    if (!sender || sender.publicId !== game.hostPublicId) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ONLY_HOST_CAN_START });
      return;
    }

    const started = game.startGame();

    if (!started) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.NEED_MORE_PLAYERS });
      return;
    }

    game.players.filter((p) => !p.isBot).forEach((player) => {
      this.transport.send(player.connectionId, 'gameStarted', {
        gameState: this._getDecoratedGameState(game),
        playerState: game.getPlayerState(player.internalId),
      });
    });

    // Initialize game logging
    if (this.loggingEnabled) {
      const logger = new GameLogger({ roomId, mode: 'server' });
      logger.startGame(game);
      this.gameLoggers.set(roomId, logger);
      const current = game.getCurrentPlayer();
      this.turnCounters.set(roomId, {
        turn: 1,
        plays: 0,
        playerName: current.name,
        isBot: !!current.isBot,
      });
      logger.logTurnStart(1, game);
    }

    this.logger.info('game started', { roomId });

    // Check if first player is a bot
    this._scheduleBotTurnIfNeeded(roomId);
  }

  handlePlayCard(connectionId, { card, source, buildingPileIndex }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_NOT_FOUND });
      return;
    }

    const player = game.getPlayerByConnectionId(connectionId);
    if (!player) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.NOT_YOUR_TURN });
      return;
    }

    const result = this._executePlay(roomId, game, player.internalId, card, source, buildingPileIndex);
    if (!result.success) {
      this.transport.send(connectionId, 'error', { message: result.error });
    }
  }

  handleDiscardCard(connectionId, { card, discardPileIndex }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_NOT_FOUND });
      return;
    }

    const player = game.getPlayerByConnectionId(connectionId);
    if (!player) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.NOT_YOUR_TURN });
      return;
    }

    const result = this._executeDiscard(roomId, game, player.internalId, card, discardPileIndex);
    if (!result.success) {
      this.transport.send(connectionId, 'error', { message: result.error });
    }
  }

  handleSendChatMessage(connectionId, { message }) {
    if (typeof message !== 'string') return;
    const sanitized = stripHtml(message.trim()).replace(/[\x00-\x1F]/g, '');
    if (sanitized.length === 0 || sanitized.length > MAX_CHAT_MESSAGE_LENGTH) return;

    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.gameRepository.getGame(roomId);
    if (!game) return;

    const player = game.getPlayerByConnectionId(connectionId);
    if (!player) return;

    this.transport.sendToGroup(roomId, 'chatMessage', {
      playerId: player.publicId,
      playerName: player.name,
      stablePlayerId: player.publicId,
      message: sanitized,
      timestamp: Date.now(),
    });

    this.logger.debug('chat message', { roomId, playerName: sanitizeForLog(player.name) });
  }

  handleAddBot(connectionId, { aiType }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_NOT_FOUND });
      return;
    }

    if (game.phase !== Phase.LOBBY) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.CANNOT_ADD_BOT_DURING_GAME });
      return;
    }

    const sender = game.getPlayerByConnectionId(connectionId);
    if (!sender || sender.publicId !== game.hostPublicId) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ONLY_HOST_CAN_ADD_BOT });
      return;
    }

    const result = this.botManager.createBot(roomId, game, aiType);
    if (!result) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_FULL });
      return;
    }

    game.setSessionToken(result.botId, this.sessionManager.generateToken());

    this.transport.sendToGroup(roomId, 'playerJoined', {
      playerId: result.publicId,
      playerName: result.botName,
      gameState: this._getDecoratedGameState(game),
    });

    this.logger.info('bot added', { roomId, botName: result.botName, aiType: result.aiType });
  }

  handleRemoveBot(connectionId, { botPlayerId }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ROOM_NOT_FOUND });
      return;
    }

    if (game.phase !== Phase.LOBBY) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.CANNOT_ADD_BOT_DURING_GAME });
      return;
    }

    const sender = game.getPlayerByConnectionId(connectionId);
    if (!sender || sender.publicId !== game.hostPublicId) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.ONLY_HOST_CAN_REMOVE_BOT });
      return;
    }

    if (!this.botManager.removeBot(roomId, game, botPlayerId)) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.NOT_A_BOT });
      return;
    }

    this.transport.sendToGroup(roomId, 'playerLeft', {
      playerId: botPlayerId,
      gameState: this._getDecoratedGameState(game),
    });

    this.logger.info('bot removed', { roomId });
  }

  handleLeaveLobby(connectionId) {
    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.gameRepository.getGame(roomId);
    if (!game || game.phase !== Phase.LOBBY) return;

    const player = game.getPlayerByConnectionId(connectionId);
    if (!player) return;
    this.logger.info('player leaving lobby', { roomId, connectionId });

    game.removePlayer(player.internalId);
    this.transport.removeFromGroup(connectionId, roomId);
    this.sessionManager.removeRoom(connectionId);

    // Check if any human players remain
    const humanPlayers = game.players.filter((p) => !p.isBot);
    if (humanPlayers.length === 0) {
      // Remove all bots and schedule room deletion
      this.botManager.clearAIs(roomId);
      this.scheduleRoomDeletion(roomId);
    } else {
      if (game.hostPublicId === player.publicId) {
        // Transfer host to next human player (never a bot)
        game.setHost(humanPlayers[0].publicId);
      }
      this.transport.sendToGroup(roomId, 'playerLeft', {
        playerId: player.publicId,
        gameState: this._getDecoratedGameState(game),
      });
    }
  }

  handleLeaveGame(connectionId) {
    this.logger.info('player leaving game', { connectionId });

    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.gameRepository.getGame(roomId);
    if (!game) return;

    const leavingPlayer = game.getPlayerByConnectionId(connectionId);

    if (game.phase === Phase.FINISHED) {
      // Post-game: soft leave (only the leaving player exits)
      if (leavingPlayer) game.removePlayer(leavingPlayer.internalId);
      this.transport.removeFromGroup(connectionId, roomId);
      this.sessionManager.removeRoom(connectionId);
      this.transport.send(connectionId, 'gameAborted');
      game.clearRematchVotes();

      const humanPlayers = game.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0) {
        this.cancelCompletedGameCleanup(roomId);
        this._cleanupLogger(roomId);
        this.botManager.cleanup(roomId);
        this.sessionManager.removeAllForPlayers(game.players);
        this.gameRepository.deleteGame(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeftPostGame', {
          gameState: this._getDecoratedGameState(game),
        });
      }

      this.logger.info('player left post-game room', { roomId, connectionId });
    } else {
      // Mid-game: abort entire game
      this.transport.sendToGroup(roomId, 'gameAborted');

      game.players.forEach((p) => {
        this.transport.removeFromGroup(p.connectionId, roomId);
        this.sessionManager.removeRoom(p.connectionId);
      });

      this.cancelPendingDeletion(roomId);
      this.cancelCompletedGameCleanup(roomId);
      this._cleanupLogger(roomId);
      this.botManager.cleanup(roomId);
      this.gameRepository.deleteGame(roomId);

      this.logger.info('game aborted', { roomId });
    }
  }

  handleRequestRematch(connectionId) {
    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.gameRepository.getGame(roomId);
    if (!game || game.phase !== Phase.FINISHED) return;

    const voter = game.getPlayerByConnectionId(connectionId);
    if (!voter) return;

    game.addRematchVote(voter.internalId);

    const humanPlayers = game.players.filter((p) => !p.isBot);
    if (game.canStartRematch(humanPlayers.length)) {
      this.cancelCompletedGameCleanup(roomId);
      game.resetForRematch();
      game.startGame();

      game.players.filter((p) => !p.isBot).forEach((player) => {
        this.transport.send(player.connectionId, 'gameStarted', {
          gameState: this._getDecoratedGameState(game),
          playerState: game.getPlayerState(player.internalId),
        });
      });

      this.logger.info('rematch started', { roomId });

      this._scheduleBotTurnIfNeeded(roomId);
    } else {
      this.transport.sendToGroup(roomId, 'rematchVoteUpdate', {
        rematchVotes: game.getRematchVoterPublicIds(),
        stockpileSize: game.stockpileSize,
      });
    }
  }

  handleUpdateRematchSettings(connectionId, { stockpileSize }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.gameRepository.getGame(roomId);
    if (!game || game.phase !== Phase.FINISHED) return;

    const sender = game.getPlayerByConnectionId(connectionId);
    if (!sender || sender.publicId !== game.hostPublicId) return;

    game.updateStockpileSize(stockpileSize);
    game.clearRematchVotes();

    this.transport.sendToGroup(roomId, 'rematchVoteUpdate', {
      rematchVotes: [],
      stockpileSize: game.stockpileSize,
    });

    this.logger.info('rematch settings updated', { roomId, stockpileSize: game.stockpileSize });
  }

  handleDisconnect(connectionId) {
    this.logger.info('player disconnected', { connectionId });

    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.gameRepository.getGame(roomId);
    if (!game) {
      this.sessionManager.removeRoom(connectionId);
      return;
    }

    const disconnectedPlayer = game.getPlayerByConnectionId(connectionId);
    const publicId = disconnectedPlayer?.publicId;

    if (game.phase === Phase.LOBBY) {
      if (disconnectedPlayer) game.removePlayer(disconnectedPlayer.internalId);
      this.transport.removeFromGroup(connectionId, roomId);
      const humanPlayers = game.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0) {
        // No humans left — clean up bots and schedule deletion
        this.botManager.clearAIs(roomId);
        this.scheduleRoomDeletion(roomId);
      } else {
        if (game.hostPublicId === publicId) {
          game.setHost(humanPlayers[0].publicId);
        }
        this.transport.sendToGroup(roomId, 'playerLeft', {
          playerId: publicId,
          gameState: this._getDecoratedGameState(game),
        });
      }
    } else if (game.phase === Phase.FINISHED) {
      // Post-game: soft remove, cancel rematch votes
      if (disconnectedPlayer) game.removePlayer(disconnectedPlayer.internalId);
      game.clearRematchVotes();

      const humanPlayers = game.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0) {
        this.cancelCompletedGameCleanup(roomId);
        this._cleanupLogger(roomId);
        this.botManager.cleanup(roomId);
        this.sessionManager.removeAllForPlayers(game.players);
        this.gameRepository.deleteGame(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeftPostGame', {
          gameState: this._getDecoratedGameState(game),
        });
      }
    } else {
      // Check if any human players remain connected
      const humansRemaining = game.players.some(
        (p) => !p.isBot && p.connectionId !== connectionId && this.sessionManager.hasRoom(p.connectionId)
      );
      if (!humansRemaining) {
        // No humans left in-game — abort
        this._cleanupLogger(roomId);
        this.botManager.cleanup(roomId);
        game.players.forEach((p) => {
          this.transport.removeFromGroup(p.connectionId, roomId);
          this.sessionManager.removeRoom(p.connectionId);
        });
        this.gameRepository.deleteGame(roomId);
        this.logger.info('game aborted — no human players remain', { roomId });
      } else {
        this.transport.sendToGroup(roomId, 'playerDisconnected', {
          playerId: publicId,
        });
      }
    }

    this.sessionManager.removeRoom(connectionId);
  }

  scheduleRoomDeletion(roomId) {
    if (this.gameRepository.pendingDeletions.size >= MAX_PENDING_ROOMS) {
      this.gameRepository.deleteGame(roomId);
      this.logger.info('empty lobby deleted immediately', { roomId });
    } else {
      this.gameRepository.scheduleDeletion(roomId, () => {
        this.gameRepository.deleteGame(roomId);
        this.logger.info('empty lobby deleted after grace period', { roomId });
      }, LOBBY_GRACE_PERIOD_MS);
      this.logger.info('empty lobby scheduled for deletion', { roomId, delaySec: LOBBY_GRACE_PERIOD_MS / 1000 });
    }
  }

  cancelPendingDeletion(roomId) {
    if (this.gameRepository.cancelDeletion(roomId)) {
      this.logger.info('cancelled pending deletion', { roomId });
    }
  }

  scheduleCompletedGameCleanup(roomId) {
    this.gameRepository.scheduleCompletedCleanup(roomId, () => {
      const game = this.gameRepository.getGame(roomId);
      if (game) {
        game.players.forEach((p) => {
          this.sessionManager.removeRoom(p.connectionId);
        });
      }
      this.botManager.clearAIs(roomId);
      this.gameRepository.deleteGame(roomId);
      this.logger.info('completed game cleaned up after TTL', { roomId });
    }, COMPLETED_GAME_TTL_MS);
  }

  cancelCompletedGameCleanup(roomId) {
    this.gameRepository.cancelCompletedCleanup(roomId);
  }

  _cleanupLogger(roomId) {
    const logger = this.gameLoggers.get(roomId);
    if (logger) {
      logger.close();
      this.gameLoggers.delete(roomId);
      this.turnCounters.delete(roomId);
    }
  }

  _scheduleBotTurnIfNeeded(roomId) {
    const game = this.gameRepository.getGame(roomId);
    if (!game || game.phase !== Phase.PLAYING) return;

    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isBot) return;

    this.botManager.scheduleTimer(roomId, () => {
      this._playBotTurn(roomId);
    });
  }

  _playBotTurn(roomId) {
    const game = this.gameRepository.getGame(roomId);
    if (!game || game.phase !== Phase.PLAYING) return;

    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isBot) return;

    const botId = currentPlayer.internalId;
    const ai = this.botManager.getAI(roomId, currentPlayer.publicId);
    if (!ai) return;

    const playNext = () => {
      if (!this.gameRepository.hasGame(roomId) || game.phase === Phase.FINISHED) return;
      if (game.getCurrentPlayer()?.internalId !== botId) return;

      const gameState = this._getDecoratedGameState(game);
      const playerState = game.getPlayerState(botId);
      const move = ai.findPlayableCard(playerState, gameState);

      if (move && game.phase === Phase.PLAYING) {
        const result = this._executePlay(roomId, game, botId, move.card, move.source, move.buildingPileIndex);
        if (!result.success) return this._botDiscard(roomId, game, botId, ai);
        if (game.phase === Phase.FINISHED) return;

        this.botManager.scheduleTimer(roomId, playNext, 500 + Math.random() * 300);
        return;
      }

      this._botDiscard(roomId, game, botId, ai);
    };

    playNext();
  }

  _botDiscard(roomId, game, botId, ai) {
    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.internalId !== botId) return;

    const gameState = this._getDecoratedGameState(game);
    const playerState = game.getPlayerState(botId);
    const discard = ai.chooseDiscard(playerState, gameState);

    if (discard) {
      this._executeDiscard(roomId, game, botId, discard.card, discard.discardPileIndex);
    }
  }

  _executePlay(roomId, game, playerId, card, source, buildingPileIndex) {
    const logger = this.gameLoggers.get(roomId);
    let stateBefore = null;
    let aiAnalysis = null;
    if (logger) {
      stateBefore = logger._snapshot(game);
      if (this.moveAnalyzer) {
        const ps = game.getPlayerState(playerId);
        const gs = this._getDecoratedGameState(game);
        aiAnalysis = this.moveAnalyzer.analyzePlay(ps, gs, { card, source, buildingPileIndex });
      }
    }

    const result = game.playCard(playerId, card, source, buildingPileIndex);
    if (!result.success) return result;

    if (logger) {
      const counter = this.turnCounters.get(roomId);
      const player = game.players.find((p) => p.internalId === playerId);
      logger.logPlay(
        counter.turn, player.name, !!player.isBot,
        { card, source, buildingPileIndex },
        stateBefore, aiAnalysis
      );
      counter.plays++;
    }

    this._broadcastToHumans(roomId, game);

    if (game.phase === Phase.FINISHED) {
      this._handleGameOver(roomId, game);
    }

    return result;
  }

  _executeDiscard(roomId, game, playerId, card, discardPileIndex) {
    const logger = this.gameLoggers.get(roomId);
    let stateBefore = null;
    let aiAnalysis = null;
    if (logger) {
      stateBefore = logger._snapshot(game);
      if (this.moveAnalyzer) {
        const ps = game.getPlayerState(playerId);
        const gs = this._getDecoratedGameState(game);
        aiAnalysis = this.moveAnalyzer.analyzeDiscard(ps, gs, { card, discardPileIndex });
      }
    }

    const result = game.discardCard(playerId, card, discardPileIndex);
    if (!result.success) return result;

    if (logger) {
      const counter = this.turnCounters.get(roomId);
      const player = game.players.find((p) => p.internalId === playerId);
      logger.logDiscard(
        counter.turn, player.name, !!player.isBot,
        { card, discardPileIndex },
        stateBefore, aiAnalysis
      );
      logger.logTurnEnd(counter.turn, counter.playerName, counter.isBot, counter.plays);
    }

    const endTurnResult = game.endTurn(playerId);
    if (!endTurnResult.success) return endTurnResult;

    if (logger) {
      const counter = this.turnCounters.get(roomId);
      counter.turn++;
      counter.plays = 0;
      const nextPlayer = game.getCurrentPlayer();
      counter.playerName = nextPlayer.name;
      counter.isBot = !!nextPlayer.isBot;
      logger.logTurnStart(counter.turn, game);
    }

    this._broadcastToHumans(roomId, game);
    this.transport.sendToGroup(roomId, 'turnChanged', {
      currentPlayerId: game.getCurrentPlayer()?.publicId,
    });

    this._scheduleBotTurnIfNeeded(roomId);

    return endTurnResult;
  }

  _handleGameOver(roomId, game) {
    const logger = this.gameLoggers.get(roomId);
    if (logger) {
      const counter = this.turnCounters.get(roomId);
      logger.logTurnEnd(counter.turn, counter.playerName, counter.isBot, counter.plays);
      logger.endGame(game);
      logger.close();
      this.gameLoggers.delete(roomId);
      this.turnCounters.delete(roomId);
    }

    this.transport.sendToGroup(roomId, 'gameOver', {
      winner: game.winner,
      gameState: this._getDecoratedGameState(game),
    });

    this.botManager.clearTimers(roomId);
    this.scheduleCompletedGameCleanup(roomId);
  }

  _getDecoratedGameState(game) {
    const state = game.getGameState();
    state.players = state.players.map((p) => {
      const player = game.players.find((gp) => gp.publicId === p.id);
      return {
        ...p,
        isBot: player ? !!player.isBot : false,
        aiType: player ? player.aiType || null : null,
      };
    });
    return state;
  }

  _broadcastToHumans(roomId, game) {
    game.players.forEach((player) => {
      if (!player.isBot) {
        this.transport.send(player.connectionId, 'gameStateUpdate', {
          gameState: this._getDecoratedGameState(game),
          playerState: game.getPlayerState(player.internalId),
        });
      }
    });
  }

}

// Exclude confusing characters: 0, O, I, 1, 5, S, 8, B, 2, Z
function generateRoomId(repository) {
  const chars = '3467ACDEFGHJKMNPQRTUVWXY';
  const MAX_ATTEMPTS = 10;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const bytes = crypto.randomBytes(6);
    let roomId = '';
    for (let i = 0; i < 6; i++) {
      roomId += chars.charAt(bytes[i] % chars.length);
    }
    if (!repository || !repository.hasGame(roomId)) {
      return roomId;
    }
  }
  return null;
}

module.exports = GameCoordinator;
