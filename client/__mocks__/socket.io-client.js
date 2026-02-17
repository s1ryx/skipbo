const createMockSocket = () => {
  const listeners = {};

  const socket = {
    id: 'test-socket-id',
    connected: true,

    on: jest.fn((event, callback) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(callback);
      return socket;
    }),

    off: jest.fn((event, callback) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((cb) => cb !== callback);
      }
      return socket;
    }),

    emit: jest.fn(),

    connect: jest.fn(() => {
      socket.connected = true;
      return socket;
    }),

    close: jest.fn(() => {
      socket.connected = false;
    }),

    disconnect: jest.fn(() => {
      socket.connected = false;
    }),

    // Test helper: simulate a server event
    _trigger: (event, ...args) => {
      if (listeners[event]) {
        listeners[event].forEach((cb) => cb(...args));
      }
    },

    // Test helper: reset all listeners
    _reset: () => {
      Object.keys(listeners).forEach((key) => delete listeners[key]);
      socket.on.mockClear();
      socket.off.mockClear();
      socket.emit.mockClear();
      socket.connect.mockClear();
      socket.close.mockClear();
      socket.disconnect.mockClear();
    },
  };

  return socket;
};

const mockSocket = createMockSocket();

const io = jest.fn(() => mockSocket);

// Expose the mock socket for test access
io._mockSocket = mockSocket;

export default io;
