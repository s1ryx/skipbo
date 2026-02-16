const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const SkipBoGame = require('./gameLogic');
const packageJson = require('./package.json');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = packageJson.version;

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
});

// Store active games
const games = new Map();
const playerRooms = new Map(); // Track which room each player is in
const pendingDeletions = new Map(); // roomId → timeoutId for grace period cleanup

const LOBBY_GRACE_PERIOD_MS = 30000; // 30 seconds before deleting empty lobbies
const MAX_PENDING_ROOMS = 50; // Cap to prevent abuse from abandoned rooms

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create or join a room
  socket.on('createRoom', ({ playerName, maxPlayers, stockpileSize }) => {
    const roomId = generateRoomId();
    const game = new SkipBoGame(roomId, maxPlayers || 2, stockpileSize);
    game.addPlayer(socket.id, playerName);

    games.set(roomId, game);
    playerRooms.set(socket.id, roomId);

    socket.join(roomId);

    socket.emit('roomCreated', {
      roomId,
      playerId: socket.id,
      gameState: game.getGameState(),
    });

    console.log(`Room created: ${roomId} by ${playerName}`);
  });

  // Join an existing room
  socket.on('joinRoom', ({ roomId, playerName }) => {
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'error.roomNotFound' });
      return;
    }

    cancelPendingDeletion(roomId);

    if (game.gameStarted) {
      socket.emit('error', { message: 'error.gameAlreadyStarted' });
      return;
    }

    const added = game.addPlayer(socket.id, playerName);

    if (!added) {
      socket.emit('error', { message: 'error.roomFull' });
      return;
    }

    playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    // Notify all players in the room
    io.to(roomId).emit('playerJoined', {
      playerId: socket.id,
      playerName,
      gameState: game.getGameState(),
    });

    console.log(`${playerName} joined room: ${roomId}`);
  });

  // Reconnect to an existing room
  socket.on('reconnect', ({ roomId, oldPlayerId, playerName }) => {
    const game = games.get(roomId);

    if (!game) {
      socket.emit('reconnectFailed', { message: 'error.roomNoLongerExists' });
      return;
    }

    cancelPendingDeletion(roomId);

    // Find the player by old ID
    const player = game.players.find((p) => p.id === oldPlayerId);

    if (!player) {
      // Player was removed (e.g. lobby disconnect) — rejoin if game hasn't started
      if (!game.gameStarted) {
        const added = game.addPlayer(socket.id, playerName);
        if (!added) {
          socket.emit('reconnectFailed', { message: 'error.roomFull' });
          return;
        }

        playerRooms.set(socket.id, roomId);
        socket.join(roomId);

        // Send reconnected to the rejoining player (restores lobby view)
        socket.emit('reconnected', {
          roomId,
          playerId: socket.id,
          gameState: game.getGameState(),
          playerState: game.getPlayerState(socket.id),
        });

        // Notify other players in the room
        socket.to(roomId).emit('playerJoined', {
          playerId: socket.id,
          playerName,
          gameState: game.getGameState(),
        });

        console.log(`${playerName} rejoined lobby: ${roomId}`);
        return;
      }

      socket.emit('reconnectFailed', { message: 'error.playerNotFound' });
      return;
    }

    // Update player's socket ID
    player.id = socket.id;

    // Update playerRooms mapping
    playerRooms.delete(oldPlayerId);
    playerRooms.set(socket.id, roomId);

    // Join the room
    socket.join(roomId);

    // Send current game state to reconnected player
    socket.emit('reconnected', {
      roomId,
      playerId: socket.id,
      gameState: game.getGameState(),
      playerState: game.getPlayerState(socket.id),
    });

    // Notify other players
    socket.to(roomId).emit('playerReconnected', {
      playerId: socket.id,
      playerName: player.name,
    });

    console.log(`${playerName} reconnected to room: ${roomId}`);
  });

  // Start the game
  socket.on('startGame', () => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'error.roomNotFound' });
      return;
    }

    const started = game.startGame();

    if (!started) {
      socket.emit('error', { message: 'error.needMorePlayers' });
      return;
    }

    // Send game state to all players
    game.players.forEach((player) => {
      io.to(player.id).emit('gameStarted', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    console.log(`Game started in room: ${roomId}`);
  });

  // Play a card
  socket.on('playCard', ({ card, source, buildingPileIndex }) => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'error.roomNotFound' });
      return;
    }

    const result = game.playCard(socket.id, card, source, buildingPileIndex);

    if (!result.success) {
      socket.emit('error', { message: result.error });
      return;
    }

    // Update all players
    game.players.forEach((player) => {
      io.to(player.id).emit('gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    // Check if game is over
    if (game.gameOver) {
      io.to(roomId).emit('gameOver', {
        winner: game.winner,
        gameState: game.getGameState(),
      });
    }
  });

  // Discard a card
  socket.on('discardCard', ({ card, discardPileIndex }) => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'error.roomNotFound' });
      return;
    }

    const result = game.discardCard(socket.id, card, discardPileIndex);

    if (!result.success) {
      socket.emit('error', { message: result.error });
      return;
    }

    // End the turn after discarding
    const endTurnResult = game.endTurn(socket.id);

    if (!endTurnResult.success) {
      socket.emit('error', { message: endTurnResult.error });
      return;
    }

    // Update all players
    game.players.forEach((player) => {
      io.to(player.id).emit('gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    // Notify about turn change
    io.to(roomId).emit('turnChanged', {
      currentPlayerId: endTurnResult.nextPlayer,
    });
  });

  // End turn
  socket.on('endTurn', () => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'error.roomNotFound' });
      return;
    }

    const result = game.endTurn(socket.id);

    if (!result.success) {
      socket.emit('error', { message: result.error });
      return;
    }

    // Update all players
    game.players.forEach((player) => {
      io.to(player.id).emit('gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id),
      });
    });

    io.to(roomId).emit('turnChanged', {
      currentPlayerId: result.nextPlayer,
    });
  });

  // Handle chat messages
  socket.on('sendChatMessage', ({ message, stablePlayerId }) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) {
      return;
    }

    const game = games.get(roomId);
    if (!game) {
      return;
    }

    // Find the player's name
    const player = game.players.find((p) => p.id === socket.id);
    if (!player) {
      return;
    }

    // Broadcast message to all players in the room
    io.to(roomId).emit('chatMessage', {
      playerId: socket.id,
      playerName: player.name,
      stablePlayerId: stablePlayerId,
      message: message.trim(),
      timestamp: Date.now(),
    });

    console.log(`Chat message in room ${roomId} from ${player.name}: ${message}`);
  });

  // Handle leave game
  socket.on('leaveGame', () => {
    console.log(`Player ${socket.id} is leaving the game`);

    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      const game = games.get(roomId);
      if (game) {
        // Notify all players in the room that the game is being aborted
        io.to(roomId).emit('gameAborted');

        // Remove all players from playerRooms
        game.players.forEach((player) => {
          playerRooms.delete(player.id);
        });

        // Delete the game
        cancelPendingDeletion(roomId);
        games.delete(roomId);

        console.log(`Game in room ${roomId} has been aborted`);
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      const game = games.get(roomId);
      if (game) {
        if (!game.gameStarted) {
          // Pre-game lobby: remove only the disconnected player
          game.removePlayer(socket.id);
          if (game.players.length === 0) {
            // Schedule deletion after grace period (allows app-switch reconnection)
            if (pendingDeletions.size >= MAX_PENDING_ROOMS) {
              // Too many pending rooms — delete immediately to prevent abuse
              games.delete(roomId);
              console.log(`Empty lobby ${roomId} deleted immediately (pending limit reached)`);
            } else {
              const timeoutId = setTimeout(() => {
                games.delete(roomId);
                pendingDeletions.delete(roomId);
                console.log(`Empty lobby ${roomId} deleted after grace period`);
              }, LOBBY_GRACE_PERIOD_MS);
              pendingDeletions.set(roomId, timeoutId);
              console.log(
                `Empty lobby ${roomId} scheduled for deletion in ${LOBBY_GRACE_PERIOD_MS / 1000}s`
              );
            }
          } else {
            // Notify remaining players
            io.to(roomId).emit('playerLeft', {
              playerId: socket.id,
              gameState: game.getGameState(),
            });
          }
        } else {
          // Mid-game: notify others, allow reconnection
          io.to(roomId).emit('playerDisconnected', {
            playerId: socket.id,
          });
        }
      }

      playerRooms.delete(socket.id);
    }
  });
});

// Cancel a pending lobby deletion (e.g. when a player joins before the grace period expires)
function cancelPendingDeletion(roomId) {
  const timeoutId = pendingDeletions.get(roomId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    pendingDeletions.delete(roomId);
    console.log(`Cancelled pending deletion for lobby ${roomId}`);
  }
}

// Helper function to generate random room ID
// Uses only easily distinguishable characters to avoid confusion
function generateRoomId() {
  // Exclude confusing characters: 0, O, I, 1, 5, S, 8, B, 2, Z
  const chars = '3467ACDEFGHJKMNPQRTUVWXY';
  let roomId = '';

  for (let i = 0; i < 6; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return roomId;
}

server.listen(PORT, HOST, () => {
  console.log(`Skip-Bo server v${VERSION} running on http://${HOST}:${PORT}`);
  console.log(`For local network access, use your machine's IP address instead of ${HOST}`);
});
