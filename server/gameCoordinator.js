const crypto = require('crypto');
const SkipBoGame = require('./gameLogic');
const { GameLogger, MoveAnalyzer } = require('./ai/GameLogger');
const { AIPlayer } = require('./ai/AIPlayer');
const { AIPlayer: BaselineAIPlayer } = require('./ai/baseline/AIPlayer');
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
    this.playerRooms = new Map();
    this.pendingDeletions = new Map();
    this.completedGameTimers = new Map();

    // Game logging
    this.loggingEnabled = options.logging ?? false;
    this.logAnalysis = options.logAnalysis ?? false;
    this.gameLoggers = new Map();   // roomId → GameLogger
    this.turnCounters = new Map();  // roomId → { turn, plays, playerName, isBot }
    this.moveAnalyzer = this.logAnalysis ? new MoveAnalyzer() : null;

    // Bot management
    this.botAIs = new Map();          // `${roomId}:${publicId}` → AIPlayer instance
    this.botTurnTimers = new Map();   // roomId → [timeoutId...]
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

    const sessionToken = crypto.randomUUID();
    game.setSessionToken(connectionId, sessionToken);
    game.players[game.players.length - 1].isBot = !!isBot;
    game.setHost(game.players[0].publicId);

    this.games.set(roomId, game);
    this.playerRooms.set(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'roomCreated', {
      roomId,
      playerId: game.getPublicId(connectionId),
      sessionToken,
      gameState: game.getGameState(),
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

    const sessionToken = crypto.randomUUID();
    game.setSessionToken(connectionId, sessionToken);
    game.players[game.players.length - 1].isBot = !!isBot;

    this.playerRooms.set(connectionId, roomId);
    this.transport.addToGroup(connectionId, roomId);

    this.transport.sendToGroup(roomId, 'playerJoined', {
      playerId: game.getPublicId(connectionId),
      playerName: validName,
      gameState: game.getGameState(),
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

        const newToken = crypto.randomUUID();
        game.setSessionToken(connectionId, newToken);

        this.playerRooms.set(connectionId, roomId);
        this.transport.addToGroup(connectionId, roomId);

        const publicId = game.getPublicId(connectionId);

        this.transport.send(connectionId, 'reconnected', {
          roomId,
          playerId: publicId,
          sessionToken: newToken,
          gameState: game.getGameState(),
          playerState: game.getPlayerState(connectionId),
        });

        this.transport.sendToGroupExcept(roomId, connectionId, 'playerJoined', {
          playerId: publicId,
          playerName: validName,
          gameState: game.getGameState(),
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
    const newToken = crypto.randomUUID();
    game.setSessionToken(connectionId, newToken);

    game.removeRematchVote(oldConnectionId);

    this.playerRooms.delete(oldConnectionId);
    this.playerRooms.set(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'reconnected', {
      roomId,
      playerId: player.publicId,
      sessionToken: newToken,
      gameState: game.getGameState(),
      playerState: game.getPlayerState(connectionId),
    });

    this.transport.sendToGroupExcept(roomId, connectionId, 'playerReconnected', {
      playerId: player.publicId,
      playerName: player.name,
    });

    console.log(`${sanitizeForLog(validName)} reconnected to room: ${roomId}`);
  }

  handleStartGame(connectionId) {
    const roomId = this.playerRooms.get(connectionId);
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
        gameState: game.getGameState(),
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
    const roomId = this.playerRooms.get(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    // Snapshot state before the play for logging
    const logger = this.gameLoggers.get(roomId);
    let stateBefore = null;
    let aiAnalysis = null;
    if (logger) {
      stateBefore = logger._snapshot(game);
      if (this.moveAnalyzer) {
        const ps = game.getPlayerState(connectionId);
        const gs = game.getGameState();
        aiAnalysis = this.moveAnalyzer.analyzePlay(ps, gs, { card, source, buildingPileIndex });
      }
    }

    const result = game.playCard(connectionId, card, source, buildingPileIndex);

    if (!result.success) {
      this.transport.send(connectionId, 'error', { message: result.error });
      return;
    }

    // Log the play
    if (logger) {
      const counter = this.turnCounters.get(roomId);
      const player = game.players.find((p) => p.id === connectionId);
      logger.logPlay(
        counter.turn, player.name, !!player.isBot,
        { card, source, buildingPileIndex },
        stateBefore, aiAnalysis
      );
      counter.plays++;
    }

    game.players.forEach((player) => {
      this.transport.send(player.id, 'gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    if (game.phase === Phase.FINISHED) {
      this.transport.sendToGroup(roomId, 'gameOver', {
        winner: game.winner,
        gameState: game.getGameState(),
      });
      if (logger) {
        const counter = this.turnCounters.get(roomId);
        logger.logTurnEnd(counter.turn, counter.playerName, counter.isBot, counter.plays);
        logger.endGame(game);
        logger.close();
        this.gameLoggers.delete(roomId);
        this.turnCounters.delete(roomId);
      }
      this.scheduleCompletedGameCleanup(roomId);
    }
  }

  handleDiscardCard(connectionId, { card, discardPileIndex }) {
    const roomId = this.playerRooms.get(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    // Snapshot state before the discard for logging
    const logger = this.gameLoggers.get(roomId);
    let stateBefore = null;
    let aiAnalysis = null;
    if (logger) {
      stateBefore = logger._snapshot(game);
      if (this.moveAnalyzer) {
        const ps = game.getPlayerState(connectionId);
        const gs = game.getGameState();
        aiAnalysis = this.moveAnalyzer.analyzeDiscard(ps, gs, { card, discardPileIndex });
      }
    }

    const result = game.discardCard(connectionId, card, discardPileIndex);

    if (!result.success) {
      this.transport.send(connectionId, 'error', { message: result.error });
      return;
    }

    // Log the discard and turn end
    if (logger) {
      const counter = this.turnCounters.get(roomId);
      const player = game.players.find((p) => p.id === connectionId);
      logger.logDiscard(
        counter.turn, player.name, !!player.isBot,
        { card, discardPileIndex },
        stateBefore, aiAnalysis
      );
      logger.logTurnEnd(counter.turn, counter.playerName, counter.isBot, counter.plays);
    }

    const endTurnResult = game.endTurn(connectionId);

    if (!endTurnResult.success) {
      this.transport.send(connectionId, 'error', { message: endTurnResult.error });
      return;
    }

    // Log the new turn start
    if (logger) {
      const counter = this.turnCounters.get(roomId);
      counter.turn++;
      counter.plays = 0;
      const nextPlayer = game.getCurrentPlayer();
      counter.playerName = nextPlayer.name;
      counter.isBot = !!nextPlayer.isBot;
      logger.logTurnStart(counter.turn, game);
    }

    game.players.forEach((player) => {
      this.transport.send(player.id, 'gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    this.transport.sendToGroup(roomId, 'turnChanged', {
      currentPlayerId: game.getPublicId(endTurnResult.nextPlayer),
    });

    // Check if next player is a bot
    this._scheduleBotTurnIfNeeded(roomId);
  }

  handleSendChatMessage(connectionId, { message }) {
    if (typeof message !== 'string') return;
    const sanitized = stripHtml(message.trim()).replace(/[\x00-\x1F]/g, '');
    if (sanitized.length === 0 || sanitized.length > MAX_CHAT_MESSAGE_LENGTH) return;

    const roomId = this.playerRooms.get(connectionId);
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
    const roomId = this.playerRooms.get(connectionId);
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

    const validAiType = (aiType === 'improved' || aiType === 'baseline') ? aiType : 'improved';
    const botConnectionId = BOT_ID_PREFIX + crypto.randomUUID();
    const botNumber = game.players.filter((p) => p.isBot).length + 1;
    const botName = `Bot ${botNumber}`;

    const added = game.addPlayer(botConnectionId, botName);
    if (!added) {
      this.transport.send(connectionId, 'error', { message: 'error.roomFull' });
      return;
    }

    const botPlayer = game.players[game.players.length - 1];
    botPlayer.isBot = true;
    botPlayer.aiType = validAiType;
    game.setSessionToken(botPlayer.id, crypto.randomUUID());

    const AIClass = validAiType === 'baseline' ? BaselineAIPlayer : AIPlayer;
    this.botAIs.set(`${roomId}:${botPlayer.publicId}`, new AIClass());

    this.transport.sendToGroup(roomId, 'playerJoined', {
      playerId: botPlayer.publicId,
      playerName: botName,
      gameState: game.getGameState(),
    });

    console.log(`Bot "${botName}" (${validAiType}) added to room ${roomId}`);
  }

  handleRemoveBot(connectionId, { botPlayerId }) {
    const roomId = this.playerRooms.get(connectionId);
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

    const botPlayer = game.players.find((p) => p.publicId === botPlayerId);
    if (!botPlayer || !botPlayer.isBot) {
      this.transport.send(connectionId, 'error', { message: 'error.notABot' });
      return;
    }

    game.removePlayer(botPlayer.id);
    this.botAIs.delete(`${roomId}:${botPlayerId}`);

    this.transport.sendToGroup(roomId, 'playerLeft', {
      playerId: botPlayerId,
      gameState: game.getGameState(),
    });

    console.log(`Bot removed from room ${roomId}`);
  }

  handleLeaveLobby(connectionId) {
    const roomId = this.playerRooms.get(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.LOBBY) return;

    const publicId = game.getPublicId(connectionId);
    console.log(`Player ${connectionId} is leaving lobby ${roomId}`);

    game.removePlayer(connectionId);
    this.transport.removeFromGroup(connectionId, roomId);
    this.playerRooms.delete(connectionId);

    // Check if any human players remain
    const humanPlayers = game.players.filter((p) => !p.isBot);
    if (humanPlayers.length === 0) {
      // Remove all bots and schedule room deletion
      for (const bot of game.players.filter((p) => p.isBot)) {
        this.botAIs.delete(`${roomId}:${bot.publicId}`);
      }
      this.scheduleRoomDeletion(roomId);
    } else {
      if (game.hostPublicId === publicId) {
        // Transfer host to next human player (never a bot)
        game.setHost(humanPlayers[0].publicId);
      }
      this.transport.sendToGroup(roomId, 'playerLeft', {
        playerId: publicId,
        gameState: game.getGameState(),
      });
    }
  }

  handleLeaveGame(connectionId) {
    console.log(`Player ${connectionId} is leaving the game`);

    const roomId = this.playerRooms.get(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game) return;

    if (game.phase === Phase.FINISHED) {
      // Post-game: soft leave (only the leaving player exits)
      game.removePlayer(connectionId);
      this.transport.removeFromGroup(connectionId, roomId);
      this.playerRooms.delete(connectionId);
      this.transport.send(connectionId, 'gameAborted');
      game.clearRematchVotes();

      const humanPlayers = game.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0) {
        this.cancelCompletedGameCleanup(roomId);
        this._cleanupLogger(roomId);
        this._clearBotTimers(roomId);
        this._clearBotAIs(roomId);
        game.players.forEach((p) => this.playerRooms.delete(p.id));
        this.games.delete(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeftPostGame', {
          gameState: game.getGameState(),
        });
      }

      console.log(`Player ${connectionId} left post-game room ${roomId}`);
    } else {
      // Mid-game: abort entire game
      this.transport.sendToGroup(roomId, 'gameAborted');

      game.players.forEach((player) => {
        this.transport.removeFromGroup(player.id, roomId);
        this.playerRooms.delete(player.id);
      });

      this.cancelPendingDeletion(roomId);
      this.cancelCompletedGameCleanup(roomId);
      this._cleanupLogger(roomId);
      this._clearBotTimers(roomId);
      this._clearBotAIs(roomId);
      this.games.delete(roomId);

      console.log(`Game in room ${roomId} has been aborted`);
    }
  }

  handleRequestRematch(connectionId) {
    const roomId = this.playerRooms.get(connectionId);
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
          gameState: game.getGameState(),
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
    const roomId = this.playerRooms.get(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.FINISHED) return;

    if (game.getPublicId(connectionId) !== game.hostPublicId) return;

    const maxAllowed = game.players.length <= 4 ? 30 : 20;
    game.stockpileSize = Math.min(Math.max(stockpileSize, 5), maxAllowed);
    game.clearRematchVotes();

    this.transport.sendToGroup(roomId, 'rematchVoteUpdate', {
      rematchVotes: [],
      stockpileSize: game.stockpileSize,
    });

    console.log(`Rematch settings updated in room ${roomId}: stockpile=${game.stockpileSize}`);
  }

  handleDisconnect(connectionId) {
    console.log(`Player disconnected: ${connectionId}`);

    const roomId = this.playerRooms.get(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game) {
      this.playerRooms.delete(connectionId);
      return;
    }

    const publicId = game.getPublicId(connectionId);

    if (game.phase === Phase.LOBBY) {
      game.removePlayer(connectionId);
      this.transport.removeFromGroup(connectionId, roomId);
      const humanPlayers = game.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0) {
        // No humans left — clean up bots and schedule deletion
        for (const bot of game.players.filter((p) => p.isBot)) {
          this.botAIs.delete(`${roomId}:${bot.publicId}`);
        }
        this.scheduleRoomDeletion(roomId);
      } else {
        if (game.hostPublicId === publicId) {
          game.setHost(humanPlayers[0].publicId);
        }
        this.transport.sendToGroup(roomId, 'playerLeft', {
          playerId: publicId,
          gameState: game.getGameState(),
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
        this._clearBotTimers(roomId);
        this._clearBotAIs(roomId);
        game.players.forEach((p) => this.playerRooms.delete(p.id));
        this.games.delete(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeftPostGame', {
          gameState: game.getGameState(),
        });
      }
    } else {
      // Check if any human players remain connected
      const humansRemaining = game.players.some(
        (p) => !p.isBot && p.id !== connectionId && this.playerRooms.has(p.id)
      );
      if (!humansRemaining) {
        // No humans left in-game — abort
        this._cleanupLogger(roomId);
        this._clearBotTimers(roomId);
        this._clearBotAIs(roomId);
        game.players.forEach((player) => {
          this.transport.removeFromGroup(player.id, roomId);
          this.playerRooms.delete(player.id);
        });
        this.games.delete(roomId);
        console.log(`Game in room ${roomId} aborted — no human players remain`);
      } else {
        this.transport.sendToGroup(roomId, 'playerDisconnected', {
          playerId: publicId,
        });
      }
    }

    this.playerRooms.delete(connectionId);
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
          this.playerRooms.delete(player.id);
        });
      }
      this._clearBotAIs(roomId);
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

    const timerId = setTimeout(() => {
      this._playBotTurn(roomId);
    }, 500);

    if (!this.botTurnTimers.has(roomId)) {
      this.botTurnTimers.set(roomId, []);
    }
    this.botTurnTimers.get(roomId).push(timerId);
  }

  _playBotTurn(roomId) {
    const game = this.games.get(roomId);
    if (!game || game.phase !== Phase.PLAYING) return;

    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isBot) return;

    const botId = currentPlayer.id;
    const aiKey = `${roomId}:${currentPlayer.publicId}`;
    const ai = this.botAIs.get(aiKey);
    if (!ai) return;

    const logger = this.gameLoggers.get(roomId);

    const playNext = () => {
      // Re-check guards — game state may have changed
      if (!this.games.has(roomId) || game.phase === Phase.FINISHED) return;
      if (game.getCurrentPlayer()?.id !== botId) return;

      const gameState = game.getGameState();
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
          this._handleBotGameOver(roomId, game, logger);
          return;
        }

        // Schedule next play with delay
        const timerId = setTimeout(playNext, 500 + Math.random() * 300);
        if (this.botTurnTimers.has(roomId)) {
          this.botTurnTimers.get(roomId).push(timerId);
        }
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

    const discardGameState = game.getGameState();
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

  _handleBotGameOver(roomId, game, logger) {
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
      gameState: game.getGameState(),
    });

    // Also send final gameStateUpdate to humans
    this._broadcastToHumans(roomId, game);

    this._clearBotTimers(roomId);
    this.scheduleCompletedGameCleanup(roomId);
  }

  _broadcastToHumans(roomId, game) {
    game.players.forEach((player) => {
      if (!player.isBot) {
        this.transport.send(player.id, 'gameStateUpdate', {
          gameState: game.getGameState(),
          playerState: game.getPlayerState(player.id),
        });
      }
    });
  }

  _clearBotTimers(roomId) {
    const timers = this.botTurnTimers.get(roomId);
    if (timers) {
      timers.forEach((id) => clearTimeout(id));
      this.botTurnTimers.delete(roomId);
    }
  }

  _clearBotAIs(roomId) {
    for (const key of this.botAIs.keys()) {
      if (key.startsWith(roomId + ':')) {
        this.botAIs.delete(key);
      }
    }
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
