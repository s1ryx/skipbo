const express = require('express');
const http = require('http');
const GameCoordinator = require('./gameCoordinator');
const SocketIOTransport = require('./transport/SocketIOTransport');
const packageJson = require('./package.json');

const app = express();
const server = http.createServer(app);

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

// Wire coordinator and transport together
const coordinator = new GameCoordinator();
const transport = new SocketIOTransport(coordinator.getTransportHandlers());
coordinator.setTransport(transport);

transport.attach(server);

server.listen(PORT, HOST, () => {
  console.log(`Skip-Bo server v${VERSION} running on http://${HOST}:${PORT}`);
  console.log(`For local network access, use your machine's IP address instead of ${HOST}`);
});
