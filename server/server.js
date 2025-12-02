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
  socket.on('createRoom', ({ playerName, maxPlayers }) => {
    const roomId = generateRoomId();
    const game = new SkipBoGame(roomId, maxPlayers || 2);
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

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      const game = games.get(roomId);
      if (game) {
        // Notify other players
        io.to(roomId).emit('playerDisconnected', {
          playerId: socket.id,
          message: 'A player has disconnected'
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
