// eslint-disable-next-line no-var
var listeners = {};
// eslint-disable-next-line no-var
var mockSocket = {
  id: 'test-socket-id',
  connected: true,
  on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
    return mockSocket;
  },
  off(event, callback) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter((cb) => cb !== callback);
    }
    return mockSocket;
  },
  emit: jest.fn(),
  close: jest.fn(),
  _trigger(event, ...args) {
    if (listeners[event]) {
      listeners[event].forEach((cb) => cb(...args));
    }
  },
  _reset() {
    Object.keys(listeners).forEach((key) => delete listeners[key]);
    mockSocket.emit.mockClear();
    mockSocket.close.mockClear();
  },
};

jest.mock('socket.io-client', () => {
  const io = () => mockSocket;
  return { __esModule: true, default: io };
});

const SocketIOClientTransport = require('./SocketIOClientTransport').default;

beforeEach(() => {
  mockSocket._reset();
});

describe('SocketIOClientTransport', () => {
  describe('constructor', () => {
    it('stores handlers and starts with no socket', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      expect(transport.handlers).toBe(handlers);
      expect(transport.socket).toBeNull();
    });
  });

  describe('connect', () => {
    it('creates a socket connection', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      transport.connect();
      expect(transport.socket).toBe(mockSocket);
    });

    it('calls onConnect with the socket id on connect event', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      transport.connect();

      mockSocket._trigger('connect');
      expect(handlers.onConnect).toHaveBeenCalledWith('test-socket-id');
    });

    it('calls onDisconnect on disconnect event', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      transport.connect();

      mockSocket._trigger('disconnect');
      expect(handlers.onDisconnect).toHaveBeenCalled();
    });

    it('forwards server events through onMessage', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      transport.connect();

      mockSocket._trigger('roomCreated', { roomId: 'ABC', playerId: 'p1' });
      expect(handlers.onMessage).toHaveBeenCalledWith('roomCreated', {
        roomId: 'ABC',
        playerId: 'p1',
      });
    });

    it('forwards all expected server events', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      transport.connect();

      const expectedEvents = [
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

      expectedEvents.forEach((event) => {
        handlers.onMessage.mockClear();
        mockSocket._trigger(event, { test: event });
        expect(handlers.onMessage).toHaveBeenCalledWith(event, { test: event });
      });
    });
  });

  describe('send', () => {
    it('emits events on the socket', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      transport.connect();

      transport.send('createRoom', { playerName: 'Alice' });
      expect(mockSocket.emit).toHaveBeenCalledWith('createRoom', { playerName: 'Alice' });
    });

    it('does nothing when socket is null', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      // Don't connect — socket stays null
      expect(() => transport.send('createRoom', {})).not.toThrow();
    });
  });

  describe('disconnect', () => {
    it('closes the socket', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      transport.connect();

      transport.disconnect();
      expect(mockSocket.close).toHaveBeenCalled();
      expect(transport.socket).toBeNull();
    });

    it('does nothing when socket is null', () => {
      const handlers = { onConnect: jest.fn(), onDisconnect: jest.fn(), onMessage: jest.fn() };
      const transport = new SocketIOClientTransport(handlers);
      expect(() => transport.disconnect()).not.toThrow();
    });
  });
});
