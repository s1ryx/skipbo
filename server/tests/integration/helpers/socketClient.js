const { io } = require('socket.io-client');

function createClient(url) {
  const socket = io(url, {
    autoConnect: false,
    forceNew: true,
    transports: ['websocket'],
  });

  const client = {
    socket,
    id: null,

    connect() {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connect timeout')), 5000);
        socket.on('connect', () => {
          clearTimeout(timeout);
          client.id = socket.id;
          resolve();
        });
        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        socket.connect();
      });
    },

    emit(event, data) {
      socket.emit(event, data);
    },

    waitFor(event, timeout = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off(event, handler);
          reject(new Error(`Timeout waiting for '${event}' (${timeout}ms)`));
        }, timeout);
        function handler(data) {
          clearTimeout(timer);
          resolve(data);
        }
        socket.once(event, handler);
      });
    },

    waitForError(timeout = 3000) {
      return client.waitFor('error', timeout);
    },

    async createRoom(name, maxPlayers = 2, stockpileSize = null) {
      const promise = client.waitFor('roomCreated');
      socket.emit('createRoom', { playerName: name, maxPlayers, stockpileSize });
      return promise;
    },

    async joinRoom(roomId, name) {
      const tokenPromise = client.waitFor('sessionToken');
      socket.emit('joinRoom', { roomId, playerName: name });
      return tokenPromise;
    },

    async startGame() {
      const promise = client.waitFor('gameStarted');
      socket.emit('startGame');
      return promise;
    },

    async playCard(card, source, buildingPileIndex) {
      const promise = client.waitFor('gameStateUpdate');
      socket.emit('playCard', { card, source, buildingPileIndex });
      return promise;
    },

    async discardCard(card, discardPileIndex) {
      const promise = client.waitFor('gameStateUpdate');
      socket.emit('discardCard', { card, discardPileIndex });
      return promise;
    },

    close() {
      return new Promise((resolve) => {
        if (socket.connected) {
          socket.on('disconnect', () => resolve());
          socket.disconnect();
        } else {
          resolve();
        }
        socket.removeAllListeners();
      });
    },
  };

  return client;
}

module.exports = { createClient };
