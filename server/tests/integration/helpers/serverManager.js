const createServer = require('../../../createServer');

function start() {
  return new Promise((resolve, reject) => {
    const { app, server, coordinator, transport } = createServer();

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}`;

      resolve({
        url,
        server,
        coordinator,
        transport,
        close() {
          return new Promise((res) => {
            // Force-close all socket.io connections (triggers disconnect handlers)
            if (transport.io) {
              transport.io.close();
            }

            // Clear coordinator timers AFTER disconnects to catch newly scheduled ones
            for (const timeoutId of coordinator.pendingDeletions.values()) {
              clearTimeout(timeoutId);
            }
            coordinator.pendingDeletions.clear();
            for (const timeoutId of coordinator.completedGameTimers.values()) {
              clearTimeout(timeoutId);
            }
            coordinator.completedGameTimers.clear();
            // Clear bot turn timers (moved to BotManager during refactoring)
            const botTimers = coordinator.botManager && coordinator.botManager.botTurnTimers;
            if (botTimers) {
              for (const timers of botTimers.values()) {
                timers.forEach((id) => clearTimeout(id));
              }
              botTimers.clear();
            }

            server.close(() => res());
          });
        },
      });
    });

    server.on('error', reject);
  });
}

module.exports = { start };
