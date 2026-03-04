const express = require('express');
const http = require('http');
const GameCoordinator = require('./gameCoordinator');
const SocketIOTransport = require('./transport/SocketIOTransport');
const packageJson = require('./package.json');

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

  // Wire coordinator and transport together
  const coordinator = new GameCoordinator({
    logging: process.env.GAME_LOGGING === '1',
    logAnalysis: process.env.GAME_LOG_ANALYSIS === '1',
  });
  const transport = new SocketIOTransport(coordinator.getTransportHandlers(), {
    rateLimitMax: options.rateLimitMax,
  });
  coordinator.setTransport(transport);

  transport.attach(server);

  return { app, server, coordinator, transport };
}

module.exports = createServer;
