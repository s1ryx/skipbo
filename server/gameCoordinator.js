const SkipBoGame = require('./gameLogic');

const LOBBY_GRACE_PERIOD_MS = 30000;
const MAX_PENDING_ROOMS = 50;

class GameCoordinator {
  constructor() {
    this.transport = null;
    this.games = new Map();
    this.playerRooms = new Map();
    this.pendingDeletions = new Map();
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
    const roomId = generateRoomId();
    const game = new SkipBoGame(roomId, maxPlayers || 2, stockpileSize);
    game.addPlayer(connectionId, playerName);

    this.games.set(roomId, game);
    this.playerRooms.set(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'roomCreated', {
      roomId,
      playerId: connectionId,
      gameState: game.getGameState(),
    });

    console.log(`Room created: ${roomId} by ${playerName}`);
  }

  handleJoinRoom(connectionId, { roomId, playerName }) {
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

    const added = game.addPlayer(connectionId, playerName);

    if (!added) {
      this.transport.send(connectionId, 'error', { message: 'error.roomFull' });
      return;
    }

    this.playerRooms.set(connectionId, roomId);
    this.transport.addToGroup(connectionId, roomId);

    this.transport.sendToGroup(roomId, 'playerJoined', {
      playerId: connectionId,
      playerName,
      gameState: game.getGameState(),
    });

    console.log(`${playerName} joined room: ${roomId}`);
  }

  handleReconnect(connectionId, { roomId, oldPlayerId, playerName }) {
    const game = this.games.get(roomId);

    if (!game) {
      this.transport.send(connectionId, 'reconnectFailed', {
        message: 'error.roomNoLongerExists',
      });
      return;
    }

    this.cancelPendingDeletion(roomId);

    const player = game.players.find((p) => p.id === oldPlayerId);

    if (!player) {
      // Player was removed — rejoin if game hasn't started
      if (!game.gameStarted) {
        const added = game.addPlayer(connectionId, playerName);
        if (!added) {
          this.transport.send(connectionId, 'reconnectFailed', { message: 'error.roomFull' });
          return;
        }

        this.playerRooms.set(connectionId, roomId);
        this.transport.addToGroup(connectionId, roomId);

        this.transport.send(connectionId, 'reconnected', {
          roomId,
          playerId: connectionId,
          gameState: game.getGameState(),
          playerState: game.getPlayerState(connectionId),
        });

        this.transport.sendToGroupExcept(roomId, connectionId, 'playerJoined', {
          playerId: connectionId,
          playerName,
          gameState: game.getGameState(),
        });

        console.log(`${playerName} rejoined lobby: ${roomId}`);
        return;
      }

      this.transport.send(connectionId, 'reconnectFailed', { message: 'error.playerNotFound' });
      return;
    }

    // Update player's connection ID
    player.id = connectionId;

    this.playerRooms.delete(oldPlayerId);
    this.playerRooms.set(connectionId, roomId);

    this.transport.addToGroup(connectionId, roomId);

    this.transport.send(connectionId, 'reconnected', {
      roomId,
      playerId: connectionId,
      gameState: game.getGameState(),
      playerState: game.getPlayerState(connectionId),
    });

    this.transport.sendToGroupExcept(roomId, connectionId, 'playerReconnected', {
      playerId: connectionId,
      playerName: player.name,
    });

    console.log(`${playerName} reconnected to room: ${roomId}`);
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
      currentPlayerId: endTurnResult.nextPlayer,
    });
  }

  handleSendChatMessage(connectionId, { message, stablePlayerId }) {
    const roomId = this.playerRooms.get(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game) return;

    const player = game.players.find((p) => p.id === connectionId);
    if (!player) return;

    this.transport.sendToGroup(roomId, 'chatMessage', {
      playerId: connectionId,
      playerName: player.name,
      stablePlayerId: stablePlayerId,
      message: message.trim(),
      timestamp: Date.now(),
    });

    console.log(`Chat message in room ${roomId} from ${player.name}: ${message}`);
  }

  handleLeaveLobby(connectionId) {
    const roomId = this.playerRooms.get(connectionId);
    if (!roomId) return;

    const game = this.games.get(roomId);
    if (!game || game.gameStarted) return;

    console.log(`Player ${connectionId} is leaving lobby ${roomId}`);

    game.removePlayer(connectionId);
    this.transport.removeFromGroup(connectionId, roomId);
    this.playerRooms.delete(connectionId);

    if (game.players.length === 0) {
      this.scheduleRoomDeletion(roomId);
    } else {
      this.transport.sendToGroup(roomId, 'playerLeft', {
        playerId: connectionId,
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
      this.playerRooms.delete(player.id);
    });

    this.cancelPendingDeletion(roomId);
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

    if (!game.gameStarted) {
      game.removePlayer(connectionId);
      if (game.players.length === 0) {
        this.scheduleRoomDeletion(roomId);
      } else {
        this.transport.sendToGroup(roomId, 'playerLeft', {
          playerId: connectionId,
          gameState: game.getGameState(),
        });
      }
    } else {
      this.transport.sendToGroup(roomId, 'playerDisconnected', {
        playerId: connectionId,
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
}

// Exclude confusing characters: 0, O, I, 1, 5, S, 8, B, 2, Z
function generateRoomId() {
  const chars = '3467ACDEFGHJKMNPQRTUVWXY';
  let roomId = '';

  for (let i = 0; i < 6; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return roomId;
}

module.exports = GameCoordinator;
