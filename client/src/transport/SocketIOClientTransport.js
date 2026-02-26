import io from 'socket.io-client';

// Every event the client expects from the server
const SERVER_EVENTS = [
  'roomCreated',
  'playerJoined',
  'playerLeft',
  'reconnected',
  'reconnectFailed',
  'sessionToken',
  'gameStarted',
  'gameStateUpdate',
  'gameOver',
  'playerDisconnected',
  'playerReconnected',
  'gameAborted',
  'chatMessage',
  'error',
];

class SocketIOClientTransport {
  /**
   * @param {object} handlers
   * @param {function(string)} handlers.onConnect - Called with connectionId
   * @param {function()} handlers.onDisconnect - Called on disconnect
   * @param {function(string, object)} handlers.onMessage - Called with event, data
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.socket = null;
  }

  /** Initiate connection to the server */
  connect() {
    const serverUrl = process.env.REACT_APP_SERVER_URL || undefined;
    this.socket = io(serverUrl);

    this.socket.on('connect', () => {
      this.handlers.onConnect(this.socket.id);
    });

    this.socket.on('disconnect', () => {
      this.handlers.onDisconnect();
    });

    SERVER_EVENTS.forEach((event) => {
      this.socket.on(event, (data) => {
        this.handlers.onMessage(event, data);
      });
    });
  }

  /** Send a message to the server */
  send(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  /** Cleanly disconnect */
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

export default SocketIOClientTransport;
