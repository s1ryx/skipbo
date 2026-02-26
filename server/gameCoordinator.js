const crypto = require('crypto');
const SkipBoGame = require('./gameLogic');

const LOBBY_GRACE_PERIOD_MS = 30000;
const MAX_PENDING_ROOMS = 50;
const MAX_TOTAL_ROOMS = 200;
const COMPLETED_GAME_TTL_MS = 300000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MIN_STOCKPILE_SIZE = 1;
const MAX_STOCKPILE_SIZE = 30;
const MAX_PLAYER_NAME_LENGTH = 30;
const MAX_CHAT_MESSAGE_LENGTH = 500;

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '');
}

function validatePlayerName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = stripHtml(name.trim()).replace(/[\x00-\x1F]/g, '');
  if (trimmed.length === 0 || trimmed.length > MAX_PLAYER_NAME_LENGTH) return null;
  return trimmed;
}

class GameCoordinator {
  constructor() {
    this.transport = null;
    this.games = new Map();
    this.playerRooms = new Map();
    this.pendingDeletions = new Map();
    this.completedGameTimers = new Map();
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
      default:
        console.log(`Unknown event: ${event}`);
    }
  }

  handleCreateRoom(connectionId, { playerName, maxPlayers, stockpileSize }) {
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
    game.players[game.players.length - 1].sessionToken = sessionToken;

    this.games.set(roomId, game);
    this.playerRooms.set(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'roomCreated', {
      roomId,
      playerId: game.getPublicId(connectionId),
      sessionToken,
      gameState: game.getGameState(),
    });

    console.log(`Room created: ${roomId} by ${validName}`);
  }

  handleJoinRoom(connectionId, { roomId, playerName }) {
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

    if (game.gameStarted) {
      this.transport.send(connectionId, 'error', { message: 'error.gameAlreadyStarted' });
      return;
    }

    const added = game.addPlayer(connectionId, validName);

    if (!added) {
      this.transport.send(connectionId, 'error', { message: 'error.roomFull' });
      return;
    }

    const sessionToken = crypto.randomUUID();
    game.players[game.players.length - 1].sessionToken = sessionToken;

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

    console.log(`${validName} joined room: ${roomId}`);
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
      if (!game.gameStarted) {
        const added = game.addPlayer(connectionId, validName);
        if (!added) {
          this.transport.send(connectionId, 'reconnectFailed', { message: 'error.roomFull' });
          return;
        }

        const newToken = crypto.randomUUID();
        game.players[game.players.length - 1].sessionToken = newToken;

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

        console.log(`${validName} rejoined lobby: ${roomId}`);
        return;
      }

      this.transport.send(connectionId, 'reconnectFailed', { message: 'error.playerNotFound' });
      return;
    }

    // Update player's connection ID and issue new session token
    const oldConnectionId = player.id;
    player.id = connectionId;
    const newToken = crypto.randomUUID();
    player.sessionToken = newToken;

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

    console.log(`${validName} reconnected to room: ${roomId}`);
  }

  handleStartGame(connectionId) {
    const roomId = this.playerRooms.get(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    const started = game.startGame();

    if (!started) {
      this.transport.send(connectionId, 'error', { message: 'error.needMorePlayers' });
      return;
    }

    game.players.forEach((player) => {
      this.transport.send(player.id, 'gameStarted', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    console.log(`Game started in room: ${roomId}`);
  }

  handlePlayCard(connectionId, { card, source, buildingPileIndex }) {
    const roomId = this.playerRooms.get(connectionId);
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'error', { message: 'error.roomNotFound' });
      return;
    }

    const result = game.playCard(connectionId, card, source, buildingPileIndex);

    if (!result.success) {
      this.transport.send(connectionId, 'error', { message: result.error });
      return;
    }

    game.players.forEach((player) => {
      this.transport.send(player.id, 'gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    if (game.gameOver) {
      this.transport.sendToGroup(roomId, 'gameOver', {
        winner: game.winner,
        gameState: game.getGameState(),
      });
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

    const result = game.discardCard(connectionId, card, discardPileIndex);

    if (!result.success) {
      this.transport.send(connectionId, 'error', { message: result.error });
      return;
    }

    const endTurnResult = game.endTurn(connectionId);

    if (!endTurnResult.success) {
      this.transport.send(connectionId, 'error', { message: endTurnResult.error });
      return;
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
  }

  handleSendChatMessage(connectionId, { message, stablePlayerId }) {
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
      stablePlayerId: stablePlayerId,
      message: sanitized,
      timestamp: Date.now(),
    });

    console.log(`Chat message in room ${roomId} from ${player.name}: ${sanitized}`);
  }

  handleLeaveLobby(connectionId) {
    const roomId = this.playerRooms.get(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game || game.gameStarted) return;

    const publicId = game.getPublicId(connectionId);
    console.log(`Player ${connectionId} is leaving lobby ${roomId}`);

    game.removePlayer(connectionId);
    this.transport.removeFromGroup(connectionId, roomId);
    this.playerRooms.delete(connectionId);

    if (game.players.length === 0) {
      this.scheduleRoomDeletion(roomId);
    } else {
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

    this.transport.sendToGroup(roomId, 'gameAborted');

    game.players.forEach((player) => {
      this.transport.removeFromGroup(player.id, roomId);
      this.playerRooms.delete(player.id);
    });

    this.cancelPendingDeletion(roomId);
    this.cancelCompletedGameCleanup(roomId);
    this.games.delete(roomId);

    console.log(`Game in room ${roomId} has been aborted`);
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

    if (!game.gameStarted) {
      game.removePlayer(connectionId);
      this.transport.removeFromGroup(connectionId, roomId);
      if (game.players.length === 0) {
        this.scheduleRoomDeletion(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeft', {
          playerId: publicId,
          gameState: game.getGameState(),
        });
      }
    } else {
      this.transport.sendToGroup(roomId, 'playerDisconnected', {
        playerId: publicId,
      });
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
