const crypto = require('crypto');
const SkipBoGame = require('./gameLogic');
const SessionManager = require('./SessionManager');
const BotManager = require('./BotManager');
const GameRepository = require('./GameRepository');
const { GameLogger, MoveAnalyzer } = require('./ai/GameLogger');
const { createLogger } = require('./logger');
const {
  LOBBY_GRACE_PERIOD_MS,
  GAME_GRACE_PERIOD_MS,
  MAX_PENDING_ROOMS,
  MAX_TOTAL_ROOMS,
  COMPLETED_GAME_TTL_MS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_STOCKPILE_SIZE,
  MAX_STOCKPILE_SIZE,
  MAX_PLAYER_NAME_LENGTH,
  MAX_CHAT_MESSAGE_LENGTH,
  BOT_TURN_START_DELAY_MS,
  BOT_PLAY_DELAY_MS,
  BOT_PLAY_JITTER_MS,
  Phase,
} = require('./config');
const { ErrorCodes } = require('./errors');

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '');
}

function sanitizeForLog(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\r\n]/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

// First 8 hex chars of SHA-256 is enough to correlate a session across log
// lines without leaking the token itself.
function hashToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function validatePlayerName(name) {
  if (typeof name !== 'string') return null;
  // eslint-disable-next-line no-control-regex
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
    this.gameLoggers = new Map(); // roomId → GameLogger
    this.turnCounters = new Map(); // roomId → { turn, plays, playerName, isBot }
    this.moveAnalyzer = this.logAnalysis ? new MoveAnalyzer() : null;

    // Per-player lobby disconnect grace timers: Map<roomId, Map<internalId, timeoutId>>
    this.lobbyDisconnectTimers = new Map();
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
      case 'passTurn':
        return this.handlePassTurn(connectionId);
      case 'sendChatMessage':
        return this.handleSendChatMessage(connectionId, data);
      case 'leaveLobby':
        return this.handleLeaveLobby(connectionId);
      case 'leaveGame':
        return this.handleLeaveGame(connectionId);
      case 'requestRematch':
        return this.handleRequestRematch(connectionId);
      case 'requestRematchWithoutDisconnected':
        return this.handleRequestRematchWithoutDisconnected(connectionId);
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

    const validMaxPlayers =
      Number.isInteger(maxPlayers) && maxPlayers >= MIN_PLAYERS && maxPlayers <= MAX_PLAYERS
        ? maxPlayers
        : MIN_PLAYERS;
    const validStockpileSize =
      Number.isInteger(stockpileSize) &&
      stockpileSize >= MIN_STOCKPILE_SIZE &&
      stockpileSize <= MAX_STOCKPILE_SIZE
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

    let added = game.addPlayer(connectionId, validName);

    if (!added) {
      // Room is full — evict a disconnected player to make space
      const disconnected = game.players.find(
        (p) => !p.isBot && !this.sessionManager.hasRoom(p.connectionId)
      );
      if (disconnected) {
        this._cancelLobbyDisconnect(roomId, disconnected.internalId);
        game.removePlayer(disconnected.internalId);
        if (game.hostPublicId === disconnected.publicId) {
          const remainingHumans = game.players.filter((p) => !p.isBot);
          if (remainingHumans.length > 0) {
            game.setHost(remainingHumans[0].publicId);
          }
        }
        added = game.addPlayer(connectionId, validName);
      }
    }

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
    const tokenHash = hashToken(sessionToken);
    const validName = validatePlayerName(playerName);
    if (!validName) {
      this.logger.info('reconnect', {
        branch: 'invalid-name',
        connectionId,
        roomId,
        tokenHash,
      });
      this.transport.send(connectionId, 'reconnectFailed', {
        message: ErrorCodes.INVALID_PLAYER_NAME,
      });
      return;
    }

    if (!sessionToken || typeof sessionToken !== 'string') {
      this.logger.info('reconnect', {
        branch: 'invalid-session',
        connectionId,
        roomId,
        tokenHash,
      });
      this.transport.send(connectionId, 'reconnectFailed', {
        message: ErrorCodes.INVALID_SESSION,
      });
      return;
    }

    const game = this.gameRepository.getGame(roomId);

    if (!game) {
      this.logger.info('reconnect', {
        branch: 'no-game',
        connectionId,
        roomId,
        tokenHash,
        knownRooms: this.gameRepository.size,
      });
      this.transport.send(connectionId, 'reconnectFailed', {
        message: ErrorCodes.ROOM_NO_LONGER_EXISTS,
      });
      return;
    }

    this.cancelPendingDeletion(roomId);

    const player = game.players.find((p) => p.sessionToken === sessionToken);

    if (!player) {
      this.logger.info('reconnect', {
        branch: 'no-player',
        connectionId,
        roomId,
        tokenHash,
        phase: game.phase,
        players: game.players.length,
        knownTokenHashes: game.players.map((p) => hashToken(p.sessionToken)),
      });
      this.transport.send(connectionId, 'reconnectFailed', {
        message: ErrorCodes.PLAYER_NOT_FOUND,
      });
      return;
    }

    // Idempotent: if the same socket re-sends `reconnect` (e.g. a client-side
    // duplicate emit), re-emit the payload without rewiring the player's
    // connection or broadcasting a fake reconnect to other clients.
    if (player.connectionId === connectionId) {
      this.logger.info('reconnect', {
        branch: 'idempotent',
        connectionId,
        roomId,
        tokenHash,
        publicId: player.publicId,
        phase: game.phase,
      });
      this.transport.send(connectionId, 'reconnected', {
        roomId,
        playerId: player.publicId,
        sessionToken: player.sessionToken,
        gameState: this._getDecoratedGameState(game),
        playerState: game.getPlayerState(player.internalId),
      });
      return;
    }

    this._cancelLobbyDisconnect(roomId, player.internalId);

    // Update player's connection ID. The session token is kept stable across
    // reconnects so a client whose persisted token hasn't been updated yet
    // (e.g. due to a fast refresh) can still recover its seat.
    const oldConnectionId = player.connectionId;
    game.updateConnectionId(player.internalId, connectionId);

    game.removeRematchVote(player.internalId);

    this.sessionManager.removeRoom(oldConnectionId);
    this.sessionManager.setRoom(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'reconnected', {
      roomId,
      playerId: player.publicId,
      sessionToken: player.sessionToken,
      gameState: this._getDecoratedGameState(game),
      playerState: game.getPlayerState(player.internalId),
    });

    this.transport.sendToGroupExcept(roomId, connectionId, 'playerReconnected', {
      playerId: player.publicId,
      playerName: player.name,
    });

    this.logger.info('reconnect', {
      branch: 'success',
      connectionId,
      oldConnectionId,
      roomId,
      tokenHash,
      publicId: player.publicId,
      phase: game.phase,
    });
    this.logger.info('player reconnected', { roomId, playerName: sanitizeForLog(validName) });

    if (game.phase === Phase.PLAYING) {
      this._scheduleBotTurnIfNeeded(roomId);
    } else if (game.phase === Phase.FINISHED) {
      this.scheduleCompletedGameCleanup(roomId);
    }
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

    const disconnectedHumans = game.players.some(
      (p) => !p.isBot && !this.sessionManager.hasRoom(p.connectionId)
    );
    if (disconnectedHumans) {
      this.transport.send(connectionId, 'error', {
        message: ErrorCodes.PLAYERS_DISCONNECTED,
      });
      return;
    }

    this._cancelAllLobbyDisconnects(roomId);

    const started = game.startGame();

    if (!started) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.NEED_MORE_PLAYERS });
      return;
    }

    game.players
      .filter((p) => !p.isBot)
      .forEach((player) => {
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

    const result = this._executePlay(
      roomId,
      game,
      player.internalId,
      card,
      source,
      buildingPileIndex
    );
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

  handlePassTurn(connectionId) {
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

    if (!game.canPass(player.internalId)) {
      this.transport.send(connectionId, 'error', { message: ErrorCodes.CANNOT_PASS });
      return;
    }

    this._executePassTurn(roomId, game, player.internalId);
  }

  handleSendChatMessage(connectionId, { message }) {
    if (typeof message !== 'string') return;
    // eslint-disable-next-line no-control-regex
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
      this.transport.send(connectionId, 'error', {
        message: ErrorCodes.CANNOT_ADD_BOT_DURING_GAME,
      });
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
      this.transport.send(connectionId, 'error', {
        message: ErrorCodes.CANNOT_ADD_BOT_DURING_GAME,
      });
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

    this._cancelLobbyDisconnect(roomId, player.internalId);
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
      this.logger.info('gameAborted emit', {
        scope: 'self',
        cause: 'leave-post-game',
        connectionId,
        roomId,
        publicId: leavingPlayer?.publicId,
      });
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
      this.logger.info('gameAborted emit', {
        scope: 'room',
        cause: 'leave-mid-game',
        connectionId,
        roomId,
        publicId: leavingPlayer?.publicId,
        phase: game.phase,
        players: game.players.length,
      });
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

    if (!this._tryStartRematch(roomId)) {
      this.transport.sendToGroup(roomId, 'rematchVoteUpdate', {
        rematchVotes: game.getRematchVoterPublicIds(),
        stockpileSize: game.stockpileSize,
      });
    }
  }

  /**
   * @private
   * Start the rematch if the vote is unanimous among the human players.
   * Returns true when a new game was dealt and broadcast, false otherwise
   * (the caller is responsible for any vote-state broadcast).
   */
  _tryStartRematch(roomId) {
    const game = this.gameRepository.getGame(roomId);
    if (!game || game.phase !== Phase.FINISHED) return false;

    const humanPlayers = game.players.filter((p) => !p.isBot);
    if (!game.canStartRematch(humanPlayers.length)) return false;

    // Don't reset/deal if too few players remain to start (e.g. a 2-player
    // game whose opponent already left post-game): startGame() would fail
    // and strand the room in a half-reset lobby state.
    if (game.players.length < MIN_PLAYERS) return false;

    this.cancelCompletedGameCleanup(roomId);
    game.resetToLobby();
    game.startGame();

    game.players
      .filter((p) => !p.isBot)
      .forEach((player) => {
        this.transport.send(player.connectionId, 'gameStarted', {
          gameState: this._getDecoratedGameState(game),
          playerState: game.getPlayerState(player.internalId),
        });
      });

    this.logger.info('rematch started', { roomId });
    this._scheduleBotTurnIfNeeded(roomId);
    return true;
  }

  handleRequestRematchWithoutDisconnected(connectionId) {
    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.gameRepository.getGame(roomId);
    if (!game || game.phase !== Phase.FINISHED) return;

    const requester = game.getPlayerByConnectionId(connectionId);
    if (!requester) return;

    // Evict every human whose connection is no longer mapped — they tabbed
    // out and have not returned. Their rematch vote leaves with them. This
    // is the survivor-driven escape hatch for a rage-quit: the remaining
    // players should not be blocked waiting on someone who is gone.
    const disconnectedHumans = game.players.filter(
      (p) => !p.isBot && !this.sessionManager.hasRoom(p.connectionId)
    );
    disconnectedHumans.forEach((p) => {
      game.removeRematchVote(p.internalId);
      game.removePlayer(p.internalId);
    });

    // The requester opts in by taking this action.
    game.addRematchVote(requester.internalId);

    this.logger.info('rematch without disconnected requested', {
      roomId,
      connectionId,
      removed: disconnectedHumans.map((p) => p.publicId),
    });

    if (!this._tryStartRematch(roomId)) {
      // Either another connected human still needs to vote, or too few
      // players remain to start. Reflect the removals and current votes.
      this.transport.sendToGroup(roomId, 'playerLeftPostGame', {
        gameState: this._getDecoratedGameState(game),
      });
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
    if (!roomId) {
      this.logger.info('disconnect', { branch: 'no-room', connectionId });
      return;
    }

    const game = this.gameRepository.getGame(roomId);
    if (!game) {
      this.logger.info('disconnect', { branch: 'no-game', connectionId, roomId });
      this.sessionManager.removeRoom(connectionId);
      return;
    }

    const disconnectedPlayer = game.getPlayerByConnectionId(connectionId);
    const publicId = disconnectedPlayer?.publicId;
    // Counted before removeRoom() below so the survivor count reflects the
    // state at the moment we decided what to do.
    const humansRemaining = this._countConnectedHumans(game, connectionId);

    if (game.phase === Phase.LOBBY) {
      this.transport.removeFromGroup(connectionId, roomId);

      const humansConnected = game.players.filter(
        (p) =>
          !p.isBot && p.connectionId !== connectionId && this.sessionManager.hasRoom(p.connectionId)
      );

      if (humansConnected.length === 0) {
        this.logger.info('disconnect', {
          branch: 'lobby-no-survivors',
          connectionId,
          roomId,
          publicId,
        });
        // No connected humans remain — clean up bots and schedule room deletion
        this._cancelAllLobbyDisconnects(roomId);
        this.botManager.clearAIs(roomId);
        this.scheduleRoomDeletion(roomId);
      } else {
        this.logger.info('disconnect', {
          branch: 'lobby-survivors',
          connectionId,
          roomId,
          publicId,
          humansConnected: humansConnected.length,
        });
        this.transport.sendToGroup(roomId, 'playerDisconnected', {
          playerId: publicId,
        });
      }

      // Schedule deferred removal so the player is cleaned up even if
      // someone else joins (cancelling room deletion) before the timer fires
      if (disconnectedPlayer) {
        this._scheduleLobbyDisconnect(roomId, disconnectedPlayer.internalId, () => {
          const currentGame = this.gameRepository.getGame(roomId);
          if (!currentGame) return;
          const player = currentGame.players.find(
            (p) => p.internalId === disconnectedPlayer.internalId
          );
          if (!player) return;

          currentGame.removePlayer(player.internalId);

          const remainingHumans = currentGame.players.filter((p) => !p.isBot);
          if (remainingHumans.length === 0) {
            this.botManager.clearAIs(roomId);
            this.scheduleRoomDeletion(roomId);
          } else {
            if (currentGame.hostPublicId === player.publicId) {
              currentGame.setHost(remainingHumans[0].publicId);
            }
            this.transport.sendToGroup(roomId, 'playerLeft', {
              playerId: player.publicId,
              gameState: this._getDecoratedGameState(currentGame),
            });
          }
        });
      }
    } else if (game.phase === Phase.FINISHED) {
      // Only drop the disconnecting player's own vote — a transient peer
      // disconnect must not wipe everyone's votes (e.g. Alice voted, Bob's
      // screen locks for a moment; Alice's vote should survive).
      if (disconnectedPlayer) game.removeRematchVote(disconnectedPlayer.internalId);

      if (humansRemaining === 0) {
        this.logger.info('disconnect', {
          branch: 'post-game-empty',
          connectionId,
          roomId,
          publicId,
        });
        this.cancelCompletedGameCleanup(roomId);
        this.scheduleGameDeletion(roomId);
      } else {
        this.logger.info('disconnect', {
          branch: 'post-game-remaining',
          connectionId,
          roomId,
          publicId,
          humansRemaining,
        });
        // A post-game disconnect is transient, exactly like a mid-game one:
        // keep the player in game.players so their session token still
        // resolves and they can reconnect into the room (e.g. to rematch).
        // The intentional-leave path (handleLeaveGame) is what removes them.
        this.transport.sendToGroup(roomId, 'playerDisconnected', {
          playerId: publicId,
        });
      }
    } else {
      if (humansRemaining === 0) {
        this.logger.info('disconnect', {
          branch: 'in-game-empty',
          connectionId,
          roomId,
          publicId,
          players: game.players.length,
          // Per-player diagnostics: shows whether each player.connectionId
          // is still mapped in sessionManager. Anything false here is the
          // reason humansRemaining hit zero.
          playerSessions: game.players.map((p) => ({
            publicId: p.publicId,
            isBot: !!p.isBot,
            hasRoom: this.sessionManager.hasRoom(p.connectionId),
            isSelf: p.connectionId === connectionId,
          })),
        });
        this.botManager.clearTimers(roomId);
        this.scheduleGameDeletion(roomId);
      } else {
        this.logger.info('disconnect', {
          branch: 'in-game-remaining',
          connectionId,
          roomId,
          publicId,
          humansRemaining,
        });
        this.transport.sendToGroup(roomId, 'playerDisconnected', {
          playerId: publicId,
        });
      }
    }

    this.sessionManager.removeRoom(connectionId);
  }

  /** @private Count humans whose session is still mapped, excluding `selfId`. */
  _countConnectedHumans(game, selfId) {
    let n = 0;
    for (const p of game.players) {
      if (p.isBot) continue;
      if (p.connectionId === selfId) continue;
      if (this.sessionManager.hasRoom(p.connectionId)) n++;
    }
    return n;
  }

  scheduleRoomDeletion(roomId) {
    if (this.gameRepository.pendingDeletions.size >= MAX_PENDING_ROOMS) {
      this.gameRepository.deleteGame(roomId);
      this.logger.info('empty lobby deleted immediately', { roomId });
    } else {
      this.gameRepository.scheduleDeletion(
        roomId,
        () => {
          const stillExists = this.gameRepository.hasGame(roomId);
          this.gameRepository.deleteGame(roomId);
          this.logger.info('deletion fired', {
            kind: 'lobby',
            roomId,
            stillExists,
          });
          this.logger.info('empty lobby deleted after grace period', { roomId });
        },
        LOBBY_GRACE_PERIOD_MS
      );
      this.logger.info('empty lobby scheduled for deletion', {
        roomId,
        delaySec: LOBBY_GRACE_PERIOD_MS / 1000,
      });
    }
  }

  scheduleGameDeletion(roomId) {
    if (this.gameRepository.pendingDeletions.size >= MAX_PENDING_ROOMS) {
      this._deleteGameFull(roomId);
      this.logger.info('game deleted immediately (too many pending)', { roomId });
    } else {
      this.gameRepository.scheduleDeletion(
        roomId,
        () => {
          const game = this.gameRepository.getGame(roomId);
          // At fire time the game *should* still exist (otherwise something
          // else deleted it under us) and all humans *should* be disconnected
          // (otherwise the timer should have been cancelled). Log enough to
          // tell us when either invariant is violated.
          this.logger.info('deletion fired', {
            kind: 'game',
            roomId,
            stillExists: !!game,
            phase: game?.phase,
            humansConnected: game
              ? game.players.filter((p) => !p.isBot && this.sessionManager.hasRoom(p.connectionId))
                  .length
              : null,
          });
          this._deleteGameFull(roomId);
          this.logger.info('game deleted after grace period', { roomId });
        },
        GAME_GRACE_PERIOD_MS
      );
      this.logger.info('game scheduled for deletion', {
        roomId,
        delaySec: GAME_GRACE_PERIOD_MS / 1000,
      });
    }
  }

  _deleteGameFull(roomId) {
    this._cancelAllLobbyDisconnects(roomId);
    const game = this.gameRepository.getGame(roomId);
    if (game) {
      this.cancelCompletedGameCleanup(roomId);
      this._cleanupLogger(roomId);
      this.botManager.cleanup(roomId);
      game.players.forEach((p) => {
        this.transport.removeFromGroup(p.connectionId, roomId);
        this.sessionManager.removeRoom(p.connectionId);
      });
      this.gameRepository.deleteGame(roomId);
    }
  }

  cancelPendingDeletion(roomId) {
    if (this.gameRepository.cancelDeletion(roomId)) {
      this.logger.info('cancelled pending deletion', { roomId });
    }
  }

  _scheduleLobbyDisconnect(roomId, internalId, callback) {
    if (!this.lobbyDisconnectTimers.has(roomId)) {
      this.lobbyDisconnectTimers.set(roomId, new Map());
    }
    const timeoutId = setTimeout(() => {
      const roomTimers = this.lobbyDisconnectTimers.get(roomId);
      if (roomTimers) {
        roomTimers.delete(internalId);
        if (roomTimers.size === 0) this.lobbyDisconnectTimers.delete(roomId);
      }
      callback();
    }, LOBBY_GRACE_PERIOD_MS);
    this.lobbyDisconnectTimers.get(roomId).set(internalId, timeoutId);
  }

  _cancelLobbyDisconnect(roomId, internalId) {
    const roomTimers = this.lobbyDisconnectTimers.get(roomId);
    if (!roomTimers) return false;
    const timeoutId = roomTimers.get(internalId);
    if (timeoutId === undefined) return false;
    clearTimeout(timeoutId);
    roomTimers.delete(internalId);
    if (roomTimers.size === 0) this.lobbyDisconnectTimers.delete(roomId);
    return true;
  }

  _cancelAllLobbyDisconnects(roomId) {
    const roomTimers = this.lobbyDisconnectTimers.get(roomId);
    if (!roomTimers) return;
    roomTimers.forEach((timeoutId) => clearTimeout(timeoutId));
    this.lobbyDisconnectTimers.delete(roomId);
  }

  scheduleCompletedGameCleanup(roomId) {
    this.gameRepository.scheduleCompletedCleanup(
      roomId,
      () => {
        const game = this.gameRepository.getGame(roomId);
        this.logger.info('deletion fired', {
          kind: 'completed',
          roomId,
          stillExists: !!game,
        });
        if (game) {
          game.players.forEach((p) => {
            this.sessionManager.removeRoom(p.connectionId);
          });
        }
        this.botManager.clearAIs(roomId);
        this.gameRepository.deleteGame(roomId);
        this.logger.info('completed game cleaned up after TTL', { roomId });
      },
      COMPLETED_GAME_TTL_MS
    );
  }

  cancelCompletedGameCleanup(roomId) {
    if (this.gameRepository.cancelCompletedCleanup(roomId)) {
      this.logger.info('cancelled completed cleanup', { roomId });
    }
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

    this.botManager.scheduleTimer(
      roomId,
      () => {
        this._playBotTurn(roomId);
      },
      BOT_TURN_START_DELAY_MS
    );
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
        const result = this._executePlay(
          roomId,
          game,
          botId,
          move.card,
          move.source,
          move.buildingPileIndex
        );
        if (!result.success) return this._botDiscard(roomId, game, botId, ai);
        if (game.phase === Phase.FINISHED) return;

        this.botManager.scheduleTimer(
          roomId,
          playNext,
          BOT_PLAY_DELAY_MS + Math.random() * BOT_PLAY_JITTER_MS
        );
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
    } else if (game.canPass(botId)) {
      this._executePassTurn(roomId, game, botId);
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
        counter.turn,
        player.name,
        !!player.isBot,
        { card, source, buildingPileIndex },
        stateBefore,
        aiAnalysis
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
        counter.turn,
        player.name,
        !!player.isBot,
        { card, discardPileIndex },
        stateBefore,
        aiAnalysis
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

  _executePassTurn(roomId, game, playerId) {
    const logger = this.gameLoggers.get(roomId);

    if (logger) {
      const counter = this.turnCounters.get(roomId);
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
        disconnected:
          player && !player.isBot ? !this.sessionManager.hasRoom(player.connectionId) : false,
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
