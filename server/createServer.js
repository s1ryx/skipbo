const express = require('express');
const http = require('http');
const GameCoordinator = require('./gameCoordinator');
const SocketIOTransport = require('./transport/SocketIOTransport');
const AuthService = require('./AuthService');
const InMemoryPlayerStore = require('./InMemoryPlayerStore');
const packageJson = require('./package.json');

function createPlayerStore(dbPath) {
  if (dbPath === false) {
    return new InMemoryPlayerStore();
  }

  try {
    const { openDatabase } = require('./database');
    const PlayerStore = require('./PlayerStore');
    const db = openDatabase(dbPath || undefined);
    return new PlayerStore(db);
  } catch {
    return new InMemoryPlayerStore();
  }
}

function createServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const VERSION = packageJson.version;

  // Health check endpoint for Docker
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      version: VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  // Player accounts (SQLite when available, in-memory fallback)
  const dbPath = options.dbPath !== undefined ? options.dbPath : process.env.SKIPBO_DB_PATH;
  const playerStore = createPlayerStore(dbPath);
  const authService = new AuthService(playerStore);

  // Wire coordinator and transport together
  const coordinator = new GameCoordinator({
    logging: process.env.GAME_LOGGING === '1',
    logAnalysis: process.env.GAME_LOG_ANALYSIS === '1',
    authService,
    playerStore,
  });
  const transport = new SocketIOTransport(coordinator.getTransportHandlers(), {
    rateLimitMax: options.rateLimitMax,
  });
  coordinator.setTransport(transport);

  transport.attach(server);

  return { app, server, coordinator, transport };
}

module.exports = createServer;
