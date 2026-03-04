// Build a mock io instance that attach() will use
const sockets = new Map();
let connectionCallbacks = [];
const emitTracker = [];

function createMockSocket(id) {
  const socket = {
    id,
    _listeners: {},
    on(event, callback) {
      if (!socket._listeners[event]) socket._listeners[event] = [];
      socket._listeners[event].push(callback);
    },
    join: jest.fn(),
    leave: jest.fn(),
    _trigger(event, data) {
      if (socket._listeners[event]) {
        socket._listeners[event].forEach((cb) => cb(data));
      }
    },
  };
  sockets.set(id, socket);
  return socket;
}

const mockIO = {
  sockets: { sockets },
  on(event, callback) {
    if (event === 'connection') connectionCallbacks.push(callback);
  },
  to(target) {
    return {
      emit(event, data) {
        emitTracker.push({ target, event, data });
      },
      except(excludeId) {
        return {
          emit(event, data) {
            emitTracker.push({ target, event, data, exclude: excludeId });
          },
        };
      },
    };
  },
};

jest.mock('socket.io', () => {
  return jest.fn(() => mockIO);
});

const SocketIOTransport = require('./SocketIOTransport');

function simulateConnection(socketId) {
  const socket = createMockSocket(socketId);
  connectionCallbacks.forEach((cb) => cb(socket));
  return socket;
}

let handlers;
let transport;

beforeEach(() => {
  sockets.clear();
  connectionCallbacks = [];
  emitTracker.length = 0;

  handlers = {
    onConnect: jest.fn(),
    onDisconnect: jest.fn(),
    onMessage: jest.fn(),
  };

  transport = new SocketIOTransport(handlers);
  transport.attach({});
});

describe('SocketIOTransport', () => {
  describe('attach', () => {
    it('sets up the io instance', () => {
      expect(transport.io).toBe(mockIO);
    });
  });

  describe('event forwarding', () => {
    it('calls onConnect when a socket connects', () => {
      simulateConnection('player1');
      expect(handlers.onConnect).toHaveBeenCalledWith('player1');
    });

    it('calls onDisconnect when a socket disconnects', () => {
      const socket = simulateConnection('player1');
      socket._trigger('disconnect');
      expect(handlers.onDisconnect).toHaveBeenCalledWith('player1');
    });

    it('forwards known client events as onMessage', () => {
      const socket = simulateConnection('player1');
      socket._trigger('createRoom', { playerName: 'Alice', maxPlayers: 2 });

      expect(handlers.onMessage).toHaveBeenCalledWith('player1', 'createRoom', {
        playerName: 'Alice',
        maxPlayers: 2,
      });
    });

    it('provides empty object for events with no data', () => {
      const socket = simulateConnection('player1');
      socket._trigger('startGame', undefined);

      expect(handlers.onMessage).toHaveBeenCalledWith('player1', 'startGame', {});
    });

    it('forwards all expected client events', () => {
      const expectedEvents = [
        'createRoom',
        'joinRoom',
        'reconnect',
        'startGame',
        'playCard',
        'discardCard',
        'sendChatMessage',
        'leaveLobby',
        'leaveGame',
      ];

      const socket = simulateConnection('player1');

      expectedEvents.forEach((event) => {
        handlers.onMessage.mockClear();
        socket._trigger(event, { test: event });
        expect(handlers.onMessage).toHaveBeenCalledWith('player1', event, { test: event });
      });
    });
  });

  describe('send', () => {
    it('emits to a specific connection', () => {
      transport.send('player1', 'roomCreated', { roomId: 'ABC' });

      expect(emitTracker).toContainEqual({
        target: 'player1',
        event: 'roomCreated',
        data: { roomId: 'ABC' },
      });
    });
  });

  describe('sendToGroup', () => {
    it('emits to a group', () => {
      transport.sendToGroup('room1', 'playerJoined', { name: 'Alice' });

      expect(emitTracker).toContainEqual({
        target: 'room1',
        event: 'playerJoined',
        data: { name: 'Alice' },
      });
    });
  });

  describe('sendToGroupExcept', () => {
    it('emits to a group excluding one connection', () => {
      transport.sendToGroupExcept('room1', 'player1', 'playerJoined', { name: 'Bob' });

      expect(emitTracker).toContainEqual({
        target: 'room1',
        event: 'playerJoined',
        data: { name: 'Bob' },
        exclude: 'player1',
      });
    });
  });

  describe('addToGroup', () => {
    it('joins the socket to a room', () => {
      const socket = simulateConnection('player1');
      transport.addToGroup('player1', 'room1');
      expect(socket.join).toHaveBeenCalledWith('room1');
    });

    it('does nothing for unknown connection', () => {
      expect(() => transport.addToGroup('unknown', 'room1')).not.toThrow();
    });
  });

  describe('removeFromGroup', () => {
    it('removes the socket from a room', () => {
      const socket = simulateConnection('player1');
      transport.removeFromGroup('player1', 'room1');
      expect(socket.leave).toHaveBeenCalledWith('room1');
    });

    it('does nothing for unknown connection', () => {
      expect(() => transport.removeFromGroup('unknown', 'room1')).not.toThrow();
    });
  });

  describe('rate limiting', () => {
    it('allows events within the rate limit', () => {
      const socket = simulateConnection('player1');
      for (let i = 0; i < 30; i++) {
        socket._trigger('startGame');
      }
      expect(handlers.onMessage).toHaveBeenCalledTimes(30);
    });

    it('drops events exceeding the rate limit', () => {
      const socket = simulateConnection('player1');
      socket.emit = jest.fn();
      for (let i = 0; i < 35; i++) {
        socket._trigger('startGame');
      }
      expect(handlers.onMessage).toHaveBeenCalledTimes(30);
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'error.rateLimited' });
    });

    it('cleans up timestamps on disconnect', () => {
      const socket = simulateConnection('player1');
      socket._trigger('startGame');
      expect(transport.eventTimestamps.has('player1')).toBe(true);

      socket._trigger('disconnect');
      expect(transport.eventTimestamps.has('player1')).toBe(false);
    });
  });
});
