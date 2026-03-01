const crypto = require('crypto');
const SkipBoGame = require('./gameLogic');
const SessionManager = require('./SessionManager');
const BotManager = require('./BotManager');
const { GameLogger, MoveAnalyzer } = require('./ai/GameLogger');
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
    this.games = new Map();
    this.sessionManager = new SessionManager();
    this.botManager = new BotManager();
    this.pendingDeletions = new Map();
    this.completedGameTimers = new Map();

    // Game logging
    this.loggingEnabled = options.logging ?? false;
    this.logAnalysis = options.logAnalysis ?? false;
    this.gameLoggers = new Map();   // roomId → GameLogger
    this.turnCounters = new Map();  // roomId → { turn, plays, playerName, isBot }
    this.moveAnalyzer = this.logAnalysis ? new MoveAnalyzer() : null;
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
    console.log(`Player connected: ${connectionId}`);
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
        console.log(`Unknown event: ${event}`);
    }
  }

  handleCreateRoom(connectionId, { playerName, maxPlayers, stockpileSize, isBot }) {
    const validName = validatePlayerName(playerName);
    if (!validName) {
      this.transport.send(connectionId, 'error', { message: 'error.invalidPlayerName' });
      return;
    }

    if (this.games.size >= MAX_TOTAL_ROOMS) {
      this.transport.send(connectionId, 'error', { message: 'error.serverFull' });
      return;
    }

    const validMaxPlayers = Number.isInteger(maxPlayers) && maxPlayers >= MIN_PLAYERS && maxPlayers <= MAX_PLAYERS
      ? maxPlayers
      : MIN_PLAYERS;
    const validStockpileSize = Number.isInteger(stockpileSize) && stockpileSize >= MIN_STOCKPILE_SIZE && stockpileSize <= MAX_STOCKPILE_SIZE
      ? stockpileSize
      : undefined;

    const roomId = generateRoomId(this.games);
    if (!roomId) {
      this.transport.send(connectionId, 'error', { message: 'error.serverFull' });
      return;
    }
    const game = new SkipBoGame(roomId, validMaxPlayers, validStockpileSize);
    game.addPlayer(connectionId, validName);

    const sessionToken = this.sessionManager.generateToken();
    game.setSessionToken(connectionId, sessionToken);
    game.players[game.players.length - 1].isBot = !!isBot;
    game.setHost(game.players[0].publicId);

    this.games.set(roomId, game);
    this.sessionManager.setRoom(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'roomCreated', {
      roomId,
      playerId: game.getPublicId(connectionId),
      sessionToken,
      gameState: this._getDecoratedGameState(game),
    });

    console.log(`Room created: ${roomId} by ${sanitizeForLog(validName)}`);
  }

  handleJoinRoom(connectionId, { roomId, playerName, isBot }) {
    const validName = validatePlayerName(playerName);
    if (!validName) {
      this.transport.send(connectionId, 'error', { message: 'error.invalidPlayerName' });
      return;
    }

    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    this.cancelPendingDeletion(roomId);

    if (game.phase !== Phase.LOBBY) {
      this.transport.send(connectionId, 'error', { message: 'error.gameAlreadyStarted' });
      return;
    }

    const added = game.addPlayer(connectionId, validName);

    if (!added) {
      this.transport.send(connectionId, 'error', { message: 'error.roomFull' });
      return;
    }

    const sessionToken = this.sessionManager.generateToken();
    game.setSessionToken(connectionId, sessionToken);
    game.players[game.players.length - 1].isBot = !!isBot;

    this.sessionManager.setRoom(connectionId, roomId);
    this.transport.addToGroup(connectionId, roomId);

    this.transport.sendToGroup(roomId, 'playerJoined', {
      playerId: game.getPublicId(connectionId),
      playerName: validName,
      gameState: this._getDecoratedGameState(game),
    });

    this.transport.send(connectionId, 'sessionToken', {
      playerId: game.getPublicId(connectionId),
      sessionToken,
    });

    console.log(`${sanitizeForLog(validName)} joined room: ${roomId}`);
  }

  handleReconnect(connectionId, { roomId, sessionToken, playerName }) {
    const validName = validatePlayerName(playerName);
    if (!validName) {
      this.transport.send(connectionId, 'reconnectFailed', {
        message: 'error.invalidPlayerName',
      });
      return;
    }

    if (!sessionToken || typeof sessionToken !== 'string') {
      this.transport.send(connectionId, 'reconnectFailed', {
        message: 'error.invalidSession',
      });
      return;
    }

    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'reconnectFailed', {
        message: 'error.roomNoLongerExists',
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
          this.transport.send(connectionId, 'reconnectFailed', { message: 'error.roomFull' });
          return;
        }

        const newToken = this.sessionManager.generateToken();
        game.setSessionToken(connectionId, newToken);

        this.sessionManager.setRoom(connectionId, roomId);
        this.transport.addToGroup(connectionId, roomId);

        const publicId = game.getPublicId(connectionId);

        this.transport.send(connectionId, 'reconnected', {
          roomId,
          playerId: publicId,
          sessionToken: newToken,
          gameState: this._getDecoratedGameState(game),
          playerState: game.getPlayerState(connectionId),
        });

        this.transport.sendToGroupExcept(roomId, connectionId, 'playerJoined', {
          playerId: publicId,
          playerName: validName,
          gameState: this._getDecoratedGameState(game),
        });

        console.log(`${sanitizeForLog(validName)} rejoined lobby: ${roomId}`);
        return;
      }

      this.transport.send(connectionId, 'reconnectFailed', { message: 'error.playerNotFound' });
      return;
    }

    // Update player's connection ID and issue new session token
    const oldConnectionId = player.id;
    game.updatePlayerId(oldConnectionId, connectionId);
    const newToken = this.sessionManager.generateToken();
    game.setSessionToken(connectionId, newToken);

    game.removeRematchVote(oldConnectionId);

    this.sessionManager.removeRoom(oldConnectionId);
    this.sessionManager.setRoom(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'reconnected', {
      roomId,
      playerId: player.publicId,
      sessionToken: newToken,
      gameState: this._getDecoratedGameState(game),
      playerState: game.getPlayerState(connectionId),
    });

    this.transport.sendToGroupExcept(roomId, connectionId, 'playerReconnected', {
      playerId: player.publicId,
      playerName: player.name,
    });

    console.log(`${sanitizeForLog(validName)} reconnected to room: ${roomId}`);
  }

  handleStartGame(connectionId) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    const senderPublicId = game.getPublicId(connectionId);
    if (senderPublicId !== game.hostPublicId) {
      this.transport.send(connectionId, 'error', { message: 'error.onlyHostCanStart' });
      return;
    }

    const started = game.startGame();

    if (!started) {
      this.transport.send(connectionId, 'error', { message: 'error.needMorePlayers' });
      return;
    }

    game.players.filter((p) => !p.isBot).forEach((player) => {
      this.transport.send(player.id, 'gameStarted', {
        gameState: this._getDecoratedGameState(game),
        playerState: game.getPlayerState(player.id),
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

    console.log(`Game started in room: ${roomId}`);

    // Check if first player is a bot
    this._scheduleBotTurnIfNeeded(roomId);
  }

  handlePlayCard(connectionId, { card, source, buildingPileIndex }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    const result = this._executePlay(roomId, game, connectionId, card, source, buildingPileIndex);
    if (!result.success) {
      this.transport.send(connectionId, 'error', { message: result.error });
    }
  }

  handleDiscardCard(connectionId, { card, discardPileIndex }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    const result = this._executeDiscard(roomId, game, connectionId, card, discardPileIndex);
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

    const game = this.games.get(roomId);
    if (!game) return;

    const player = game.players.find((p) => p.id === connectionId);
    if (!player) return;

    this.transport.sendToGroup(roomId, 'chatMessage', {
      playerId: player.publicId,
      playerName: player.name,
      stablePlayerId: player.publicId,
      message: sanitized,
      timestamp: Date.now(),
    });

    console.log(`Chat message in room ${roomId} from ${sanitizeForLog(player.name)}: ${sanitizeForLog(sanitized)}`);
  }

  handleAddBot(connectionId, { aiType }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    if (game.phase !== Phase.LOBBY) {
      this.transport.send(connectionId, 'error', { message: 'error.cannotAddBotDuringGame' });
      return;
    }

    const senderPublicId = game.getPublicId(connectionId);
    if (senderPublicId !== game.hostPublicId) {
      this.transport.send(connectionId, 'error', { message: 'error.onlyHostCanAddBot' });
      return;
    }

    const result = this.botManager.createBot(roomId, game, aiType);
    if (!result) {
      this.transport.send(connectionId, 'error', { message: 'error.roomFull' });
      return;
    }

    game.setSessionToken(result.botId, this.sessionManager.generateToken());

    this.transport.sendToGroup(roomId, 'playerJoined', {
      playerId: result.publicId,
      playerName: result.botName,
      gameState: this._getDecoratedGameState(game),
    });

    console.log(`Bot "${result.botName}" (${result.aiType}) added to room ${roomId}`);
  }

  handleRemoveBot(connectionId, { botPlayerId }) {
    const roomId = this.sessionManager.getRoom(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    if (game.phase !== Phase.LOBBY) {
      this.transport.send(connectionId, 'error', { message: 'error.cannotAddBotDuringGame' });
      return;
    }

    const senderPublicId = game.getPublicId(connectionId);
    if (senderPublicId !== game.hostPublicId) {
      this.transport.send(connectionId, 'error', { message: 'error.onlyHostCanRemoveBot' });
      return;
    }

    if (!this.botManager.removeBot(roomId, game, botPlayerId)) {
      this.transport.send(connectionId, 'error', { message: 'error.notABot' });
      return;
    }

    this.transport.sendToGroup(roomId, 'playerLeft', {
      playerId: botPlayerId,
      gameState: this._getDecoratedGameState(game),
    });

    console.log(`Bot removed from room ${roomId}`);
  }

  handleLeaveLobby(connectionId) {
    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.LOBBY) return;

    const publicId = game.getPublicId(connectionId);
    console.log(`Player ${connectionId} is leaving lobby ${roomId}`);

    game.removePlayer(connectionId);
    this.transport.removeFromGroup(connectionId, roomId);
    this.sessionManager.removeRoom(connectionId);

    // Check if any human players remain
    const humanPlayers = game.players.filter((p) => !p.isBot);
    if (humanPlayers.length === 0) {
      // Remove all bots and schedule room deletion
      this.botManager.clearAIs(roomId);
      this.scheduleRoomDeletion(roomId);
    } else {
      if (game.hostPublicId === publicId) {
        // Transfer host to next human player (never a bot)
        game.setHost(humanPlayers[0].publicId);
      }
      this.transport.sendToGroup(roomId, 'playerLeft', {
        playerId: publicId,
        gameState: this._getDecoratedGameState(game),
      });
    }
  }

  handleLeaveGame(connectionId) {
    console.log(`Player ${connectionId} is leaving the game`);

    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game) return;

    if (game.phase === Phase.FINISHED) {
      // Post-game: soft leave (only the leaving player exits)
      game.removePlayer(connectionId);
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
        this.games.delete(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeftPostGame', {
          gameState: this._getDecoratedGameState(game),
        });
      }

      console.log(`Player ${connectionId} left post-game room ${roomId}`);
    } else {
      // Mid-game: abort entire game
      this.transport.sendToGroup(roomId, 'gameAborted');

      game.players.forEach((player) => {
        this.transport.removeFromGroup(player.id, roomId);
        this.sessionManager.removeRoom(player.id);
      });

      this.cancelPendingDeletion(roomId);
      this.cancelCompletedGameCleanup(roomId);
      this._cleanupLogger(roomId);
      this.botManager.cleanup(roomId);
      this.games.delete(roomId);

      console.log(`Game in room ${roomId} has been aborted`);
    }
  }

  handleRequestRematch(connectionId) {
    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.FINISHED) return;

    game.addRematchVote(connectionId);

    const humanPlayers = game.players.filter((p) => !p.isBot);
    if (game.canStartRematch(humanPlayers.length)) {
      this.cancelCompletedGameCleanup(roomId);
      game.resetForRematch();
      game.startGame();

      game.players.filter((p) => !p.isBot).forEach((player) => {
        this.transport.send(player.id, 'gameStarted', {
          gameState: this._getDecoratedGameState(game),
          playerState: game.getPlayerState(player.id),
        });
      });

      console.log(`Rematch started in room ${roomId}`);

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

    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.FINISHED) return;

    if (game.getPublicId(connectionId) !== game.hostPublicId) return;

    game.updateStockpileSize(stockpileSize);
    game.clearRematchVotes();

    this.transport.sendToGroup(roomId, 'rematchVoteUpdate', {
      rematchVotes: [],
      stockpileSize: game.stockpileSize,
    });

    console.log(`Rematch settings updated in room ${roomId}: stockpile=${game.stockpileSize}`);
  }

  handleDisconnect(connectionId) {
    console.log(`Player disconnected: ${connectionId}`);

    const roomId = this.sessionManager.getRoom(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game) {
      this.sessionManager.removeRoom(connectionId);
      return;
    }

    const publicId = game.getPublicId(connectionId);

    if (game.phase === Phase.LOBBY) {
      game.removePlayer(connectionId);
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
      game.removePlayer(connectionId);
      game.clearRematchVotes();

      const humanPlayers = game.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0) {
        this.cancelCompletedGameCleanup(roomId);
        this._cleanupLogger(roomId);
        this.botManager.cleanup(roomId);
        this.sessionManager.removeAllForPlayers(game.players);
        this.games.delete(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeftPostGame', {
          gameState: this._getDecoratedGameState(game),
        });
      }
    } else {
      // Check if any human players remain connected
      const humansRemaining = game.players.some(
        (p) => !p.isBot && p.id !== connectionId && this.sessionManager.hasRoom(p.id)
      );
      if (!humansRemaining) {
        // No humans left in-game — abort
        this._cleanupLogger(roomId);
        this.botManager.cleanup(roomId);
        game.players.forEach((player) => {
          this.transport.removeFromGroup(player.id, roomId);
          this.sessionManager.removeRoom(player.id);
        });
        this.games.delete(roomId);
        console.log(`Game in room ${roomId} aborted — no human players remain`);
      } else {
        this.transport.sendToGroup(roomId, 'playerDisconnected', {
          playerId: publicId,
        });
      }
    }

    this.sessionManager.removeRoom(connectionId);
  }

  scheduleRoomDeletion(roomId) {
    if (this.pendingDeletions.size >= MAX_PENDING_ROOMS) {
      this.games.delete(roomId);
      console.log(`Empty lobby ${roomId} deleted immediately (pending limit reached)`);
    } else {
      const timeoutId = setTimeout(() => {
        this.games.delete(roomId);
        this.pendingDeletions.delete(roomId);
        console.log(`Empty lobby ${roomId} deleted after grace period`);
      }, LOBBY_GRACE_PERIOD_MS);
      this.pendingDeletions.set(roomId, timeoutId);
      console.log(
        `Empty lobby ${roomId} scheduled for deletion in ${LOBBY_GRACE_PERIOD_MS / 1000}s`
      );
    }
  }

  cancelPendingDeletion(roomId) {
    const timeoutId = this.pendingDeletions.get(roomId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pendingDeletions.delete(roomId);
      console.log(`Cancelled pending deletion for lobby ${roomId}`);
    }
  }

  scheduleCompletedGameCleanup(roomId) {
    const timeoutId = setTimeout(() => {
      const game = this.games.get(roomId);
      if (game) {
        game.players.forEach((player) => {
          this.sessionManager.removeRoom(player.id);
        });
      }
      this.botManager.clearAIs(roomId);
      this.games.delete(roomId);
      this.completedGameTimers.delete(roomId);
      console.log(`Completed game ${roomId} cleaned up after TTL`);
    }, COMPLETED_GAME_TTL_MS);
    this.completedGameTimers.set(roomId, timeoutId);
  }

  cancelCompletedGameCleanup(roomId) {
    const timeoutId = this.completedGameTimers.get(roomId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.completedGameTimers.delete(roomId);
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
    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.PLAYING) return;

    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isBot) return;

    this.botManager.scheduleTimer(roomId, () => {
      this._playBotTurn(roomId);
    });
  }

  _playBotTurn(roomId) {
    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.PLAYING) return;

    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isBot) return;

    const botId = currentPlayer.id;
    const ai = this.botManager.getAI(roomId, currentPlayer.publicId);
    if (!ai) return;

    const logger = this.gameLoggers.get(roomId);

    const playNext = () => {
      // Re-check guards — game state may have changed
      if (!this.games.has(roomId) || game.phase === Phase.FINISHED) return;
      if (game.getCurrentPlayer()?.id !== botId) return;

      const gameState = this._getDecoratedGameState(game);
      const playerState = game.getPlayerState(botId);
      const move = ai.findPlayableCard(playerState, gameState);

      if (move && game.phase === Phase.PLAYING) {
        // Log before play
        let stateBefore = null;
        let aiAnalysis = null;
        if (logger) {
          stateBefore = logger._snapshot(game);
          if (this.moveAnalyzer) {
            aiAnalysis = this.moveAnalyzer.analyzePlay(playerState, gameState, {
              card: move.card, source: move.source, buildingPileIndex: move.buildingPileIndex,
            });
          }
        }

        const result = game.playCard(botId, move.card, move.source, move.buildingPileIndex);
        if (!result.success) return this._botDiscard(roomId, game, botId, ai, logger);

        // Log the play
        if (logger) {
          const counter = this.turnCounters.get(roomId);
          logger.logPlay(
            counter.turn, currentPlayer.name, true,
            { card: move.card, source: move.source, buildingPileIndex: move.buildingPileIndex },
            stateBefore, aiAnalysis
          );
          counter.plays++;
        }

        // Broadcast to humans
        this._broadcastToHumans(roomId, game);

        if (game.phase === Phase.FINISHED) {
          this._handleGameOver(roomId, game);
          return;
        }

        // Schedule next play with delay
        this.botManager.scheduleTimer(roomId, playNext, 500 + Math.random() * 300);
        return;
      }

      // No more plays — discard
      this._botDiscard(roomId, game, botId, ai, logger);
    };

    playNext();
  }

  _botDiscard(roomId, game, botId, ai, logger) {
    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== botId) return;

    const discardGameState = this._getDecoratedGameState(game);
    const discardPlayerState = game.getPlayerState(botId);
    const discard = ai.chooseDiscard(discardPlayerState, discardGameState);

    if (discard) {
      // Log before discard
      let stateBefore = null;
      let aiAnalysis = null;
      if (logger) {
        stateBefore = logger._snapshot(game);
        if (this.moveAnalyzer) {
          aiAnalysis = this.moveAnalyzer.analyzeDiscard(discardPlayerState, discardGameState, {
            card: discard.card, discardPileIndex: discard.discardPileIndex,
          });
        }
      }

      const result = game.discardCard(botId, discard.card, discard.discardPileIndex);
      if (!result.success) return;

      // Log the discard
      if (logger) {
        const counter = this.turnCounters.get(roomId);
        logger.logDiscard(
          counter.turn, currentPlayer.name, true,
          { card: discard.card, discardPileIndex: discard.discardPileIndex },
          stateBefore, aiAnalysis
        );
        logger.logTurnEnd(counter.turn, currentPlayer.name, true, counter.plays);
      }
    }

    // End turn
    const endTurnResult = game.endTurn(botId);
    if (!endTurnResult.success) return;

    // Log new turn start
    if (logger) {
      const counter = this.turnCounters.get(roomId);
      counter.turn++;
      counter.plays = 0;
      const nextPlayer = game.getCurrentPlayer();
      counter.playerName = nextPlayer.name;
      counter.isBot = !!nextPlayer.isBot;
      logger.logTurnStart(counter.turn, game);
    }

    // Broadcast final state to humans
    this._broadcastToHumans(roomId, game);
    this.transport.sendToGroup(roomId, 'turnChanged', {
      currentPlayerId: game.getCurrentPlayer()?.publicId,
    });

    // Check if next player is also a bot
    this._scheduleBotTurnIfNeeded(roomId);
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
      const player = game.players.find((p) => p.id === playerId);
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
      const player = game.players.find((p) => p.id === playerId);
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
        this.transport.send(player.id, 'gameStateUpdate', {
          gameState: this._getDecoratedGameState(game),
          playerState: game.getPlayerState(player.id),
        });
      }
    });
  }

}

// Exclude confusing characters: 0, O, I, 1, 5, S, 8, B, 2, Z
function generateRoomId(existingIds) {
  const chars = '3467ACDEFGHJKMNPQRTUVWXY';
  const MAX_ATTEMPTS = 10;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const bytes = crypto.randomBytes(6);
    let roomId = '';
    for (let i = 0; i < 6; i++) {
      roomId += chars.charAt(bytes[i] % chars.length);
    }
    if (!existingIds || !existingIds.has(roomId)) {
      return roomId;
    }
  }
  return null;
}

module.exports = GameCoordinator;
