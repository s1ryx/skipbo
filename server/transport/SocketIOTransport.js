const socketIO = require('socket.io');

const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX_EVENTS = 30;

// Every event the server expects from clients
const CLIENT_EVENTS = [
  'createRoom',
  'joinRoom',
  'reconnect',
  'startGame',
  'playCard',
  'discardCard',
  'sendChatMessage',
  'leaveLobby',
  'leaveGame',
  'requestRematch',
  'updateRematchSettings',
];

class SocketIOTransport {
  /**
   * @param {object} handlers
   * @param {function(string)} handlers.onConnect - Called with connectionId
   * @param {function(string)} handlers.onDisconnect - Called with connectionId
   * @param {function(string, string, object)} handlers.onMessage - Called with connectionId, event, data
   */
  constructor(handlers, options = {}) {
    this.handlers = handlers;
    this.io = null;
    this.eventTimestamps = new Map();
    this.rateLimitMax = options.rateLimitMax || RATE_LIMIT_MAX_EVENTS;
  }

  /** Bind to an existing http.Server instance */
  attach(httpServer) {
    const origin = process.env.CORS_ORIGIN || '*';
    const corsOptions = {
      origin,
      methods: ['GET', 'POST'],
    };
    // credentials: true is incompatible with origin: '*'
    if (origin !== '*') {
      corsOptions.credentials = true;
    }
    this.io = socketIO(httpServer, { cors: corsOptions });

    this.io.on('connection', (socket) => {
      this.handlers.onConnect(socket.id);

      CLIENT_EVENTS.forEach((event) => {
        socket.on(event, (data) => {
          if (this._isRateLimited(socket)) return;
          this.handlers.onMessage(socket.id, event, data || {});
        });
      });

      socket.on('disconnect', () => {
        this.eventTimestamps.delete(socket.id);
        this.handlers.onDisconnect(socket.id);
      });
    });
  }

  /** Send a message to a single connection */
  send(connectionId, event, data) {
    this.io.to(connectionId).emit(event, data);
  }

  /** Send a message to every connection in a group */
  sendToGroup(groupId, event, data) {
    this.io.to(groupId).emit(event, data);
  }

  /** Send a message to every connection in a group except one */
  sendToGroupExcept(groupId, excludeConnectionId, event, data) {
    this.io.to(groupId).except(excludeConnectionId).emit(event, data);
  }

  /** Add a connection to a named group */
  addToGroup(connectionId, groupId) {
    const socket = this.io.sockets.sockets.get(connectionId);
    if (socket) {
      socket.join(groupId);
    }
  }

  /** Remove a connection from a named group */
  removeFromGroup(connectionId, groupId) {
    const socket = this.io.sockets.sockets.get(connectionId);
    if (socket) {
      socket.leave(groupId);
    }
  }

  /** @private Check if a connection has exceeded the rate limit */
  _isRateLimited(socket) {
    const now = Date.now();
    let timestamps = this.eventTimestamps.get(socket.id);
    if (!timestamps) {
      timestamps = [];
      this.eventTimestamps.set(socket.id, timestamps);
    }

    // Remove timestamps outside the window
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.rateLimitMax) {
      socket.emit('error', { message: 'error.rateLimited' });
      return true;
    }

    timestamps.push(now);
    return false;
  }
}

module.exports = SocketIOTransport;
