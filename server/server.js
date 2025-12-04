const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const SkipBoGame = require('./gameLogic');
const packageJson = require('./package.json');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = packageJson.version;

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    version: VERSION,
    timestamp: new Date().toISOString()
  });
});

// Store active games
const games = new Map();
const playerRooms = new Map(); // Track which room each player is in

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
      gameState: game.getGameState()
    });

    console.log(`Room created: ${roomId} by ${playerName}`);
  });

  // Join an existing room
  socket.on('joinRoom', ({ roomId, playerName }) => {
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (game.gameStarted) {
      socket.emit('error', { message: 'Game already started' });
      return;
    }

    const added = game.addPlayer(socket.id, playerName);

    if (!added) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    // Notify all players in the room
    io.to(roomId).emit('playerJoined', {
      playerId: socket.id,
      playerName,
      gameState: game.getGameState()
    });

    console.log(`${playerName} joined room: ${roomId}`);
  });

  // Reconnect to an existing room
  socket.on('reconnect', ({ roomId, oldPlayerId, playerName }) => {
    const game = games.get(roomId);

    if (!game) {
      socket.emit('reconnectFailed', { message: 'Room no longer exists' });
      return;
    }

    // Find the player by old ID
    const player = game.players.find(p => p.id === oldPlayerId);

    if (!player) {
      socket.emit('reconnectFailed', { message: 'Player not found in room' });
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
      playerState: game.getPlayerState(socket.id)
    });

    // Notify other players
    socket.to(roomId).emit('playerReconnected', {
      playerId: socket.id,
      playerName: player.name
    });

    console.log(`${playerName} reconnected to room: ${roomId}`);
  });

  // Start the game
  socket.on('startGame', () => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const started = game.startGame();

    if (!started) {
      socket.emit('error', { message: 'Cannot start game (need at least 2 players)' });
      return;
    }

    // Send game state to all players
    game.players.forEach(player => {
      io.to(player.id).emit('gameStarted', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id)
      });
    });

    console.log(`Game started in room: ${roomId}`);
  });

  // Play a card
  socket.on('playCard', ({ card, source, buildingPileIndex }) => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const result = game.playCard(socket.id, card, source, buildingPileIndex);

    if (!result.success) {
      socket.emit('error', { message: result.error });
      return;
    }

    // Update all players
    game.players.forEach(player => {
      io.to(player.id).emit('gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id)
      });
    });

    // Check if game is over
    if (game.gameOver) {
      io.to(roomId).emit('gameOver', {
        winner: game.winner,
        gameState: game.getGameState()
      });
    }
  });

  // Discard a card
  socket.on('discardCard', ({ card, discardPileIndex }) => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Room not found' });
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
    game.players.forEach(player => {
      io.to(player.id).emit('gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id)
      });
    });

    // Notify about turn change
    io.to(roomId).emit('turnChanged', {
      currentPlayerId: endTurnResult.nextPlayer
    });
  });

  // End turn
  socket.on('endTurn', () => {
    const roomId = playerRooms.get(socket.id);
    const game = games.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const result = game.endTurn(socket.id);

    if (!result.success) {
      socket.emit('error', { message: result.error });
      return;
    }

    // Update all players
    game.players.forEach(player => {
      io.to(player.id).emit('gameStateUpdate', {
        gameState: game.getGameState(),
        playerState: game.getPlayerState(player.id)
      });
    });

    io.to(roomId).emit('turnChanged', {
      currentPlayerId: result.nextPlayer
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
    const player = game.players.find(p => p.id === socket.id);
    if (!player) {
      return;
    }

    // Broadcast message to all players in the room
    io.to(roomId).emit('chatMessage', {
      playerId: socket.id,
      playerName: player.name,
      stablePlayerId: stablePlayerId,
      message: message.trim(),
      timestamp: Date.now()
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
        game.players.forEach(player => {
          playerRooms.delete(player.id);
        });

        // Delete the game
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
        // Notify other players
        io.to(roomId).emit('playerDisconnected', {
          playerId: socket.id
        });

        // If game hasn't started, remove the game
        if (!game.gameStarted) {
          games.delete(roomId);
        }
      }

      playerRooms.delete(socket.id);
    }
  });
});

// Helper function to generate random room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

server.listen(PORT, HOST, () => {
  console.log(`Skip-Bo server v${VERSION} running on http://${HOST}:${PORT}`);
  console.log(`For local network access, use your machine's IP address instead of ${HOST}`);
});
