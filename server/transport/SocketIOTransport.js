const socketIO = require('socket.io');

// Every event the server expects from clients
const CLIENT_EVENTS = [
  'createRoom',
  'joinRoom',
  'reconnect',
  'startGame',
  'playCard',
  'discardCard',
  'endTurn',
  'sendChatMessage',
  'leaveLobby',
  'leaveGame',
];

class SocketIOTransport {
  /**
   * @param {object} handlers
   * @param {function(string)} handlers.onConnect - Called with connectionId
   * @param {function(string)} handlers.onDisconnect - Called with connectionId
   * @param {function(string, string, object)} handlers.onMessage - Called with connectionId, event, data
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.io = null;
  }

  /** Bind to an existing http.Server instance */
  attach(httpServer) {
    this.io = socketIO(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    this.io.on('connection', (socket) => {
      this.handlers.onConnect(socket.id);

      CLIENT_EVENTS.forEach((event) => {
        socket.on(event, (data) => {
          this.handlers.onMessage(socket.id, event, data || {});
        });
      });

      socket.on('disconnect', () => {
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
}

module.exports = SocketIOTransport;
