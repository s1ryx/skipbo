import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { LanguageProvider } from './i18n';

import App from './App';

// CRA sets resetMocks: true, which clears jest.fn() implementations before
// each test. Use plain functions so the mock survives across test boundaries.
// Use jest.spyOn() in individual tests when you need call assertions.
//
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
  emit() {},
  connect() {
    mockSocket.connected = true;
    return mockSocket;
  },
  close() {
    mockSocket.connected = false;
  },
  disconnect() {
    mockSocket.connected = false;
  },
  _trigger(event, ...args) {
    if (listeners[event]) {
      listeners[event].forEach((cb) => cb(...args));
    }
  },
  _reset() {
    Object.keys(listeners).forEach((key) => delete listeners[key]);
  },
};

jest.mock('socket.io-client', () => {
  const io = () => mockSocket;
  io._mockSocket = mockSocket;
  return { __esModule: true, default: io };
});

const renderApp = () => {
  return render(
    <LanguageProvider>
      <App />
    </LanguageProvider>
  );
};

beforeEach(() => {
  mockSocket._reset();
  sessionStorage.clear();
  // Lobby.js creates a BroadcastChannel on mount; provide a mock for jsdom
  global.BroadcastChannel = jest.fn().mockImplementation(() => ({
    postMessage: jest.fn(),
    close: jest.fn(),
    onmessage: null,
  }));
});

afterEach(() => {
  delete global.BroadcastChannel;
  window.history.replaceState({}, '', '/');
});

describe('App', () => {
  it('renders without crashing', () => {
    renderApp();
  });

  it('renders the app title', () => {
    renderApp();
    expect(screen.getByText('Skip-Bo Card Game')).toBeInTheDocument();
  });

  it('shows the lobby by default', () => {
    renderApp();
    expect(screen.getByText('Create a New Game')).toBeInTheDocument();
  });

  it('renders the language selector', () => {
    renderApp();
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('renders the version in the footer', () => {
    renderApp();
    const { version } = require('../package.json');
    expect(screen.getByText(`v${version}`)).toBeInTheDocument();
  });

  describe('error handling', () => {
    it('shows error message on server error event', () => {
      renderApp();
      act(() => {
        mockSocket._trigger('error', { message: 'error.roomNotFound' });
      });
      expect(screen.getByText('Room not found')).toBeInTheDocument();
    });

    it('clears error message after timeout', () => {
      jest.useFakeTimers();
      renderApp();
      act(() => {
        mockSocket._trigger('error', { message: 'error.roomNotFound' });
      });
      expect(screen.getByText('Room not found')).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(screen.queryByText('Room not found')).not.toBeInTheDocument();
      jest.useRealTimers();
    });

    it('shows error on reconnection failure', () => {
      renderApp();
      act(() => {
        mockSocket._trigger('reconnectFailed', { message: 'error.roomNoLongerExists' });
      });
      expect(screen.getByText('Room no longer exists')).toBeInTheDocument();
    });
  });

  describe('invite link handoff', () => {
    it('extracts room from URL and passes to Lobby', () => {
      window.history.pushState({}, '', '/?room=abc');
      renderApp();
      expect(screen.getByText('Join a Game')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter room ID').value).toBe('ABC');
    });

    it('cleans room parameter from URL', () => {
      const replaceStateSpy = jest.spyOn(window.history, 'replaceState');
      window.history.pushState({}, '', '/?room=TEST');
      renderApp();
      // Called by App for URL cleanup (plus the afterEach cleanup call)
      expect(replaceStateSpy).toHaveBeenCalledWith({}, document.title, '/');
      replaceStateSpy.mockRestore();
    });

    it('creates BroadcastChannel and posts joinRoom message', () => {
      window.history.pushState({}, '', '/?room=xyz');
      renderApp();
      // App.js creates a second BroadcastChannel for the handoff
      const appCall = global.BroadcastChannel.mock.results.find(
        (r) => r.value && r.value.postMessage.mock.calls.length > 0
      );
      expect(appCall).toBeTruthy();
      expect(appCall.value.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'joinRoom',
          roomId: 'XYZ',
        })
      );
    });
  });

  describe('socket event handling', () => {
    const fakeGameState = {
      roomId: 'ABCD12',
      players: [
        {
          id: 'p1',
          name: 'Alice',
          stockpileCount: 0,
          handCount: 0,
          discardPiles: [[], [], [], []],
        },
      ],
      buildingPiles: [[], [], [], []],
      currentPlayerIndex: 0,
      currentPlayerId: 'p1',
      deckCount: 100,
      gameStarted: false,
      gameOver: false,
      winner: null,
    };

    it('shows game board after room creation', () => {
      renderApp();
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ABCD12',
          playerId: 'p1',
          gameState: fakeGameState,
        });
      });
      expect(screen.queryByText('Create a New Game')).not.toBeInTheDocument();
      expect(screen.getByText('Room: ABCD12')).toBeInTheDocument();
    });

    it('returns to lobby after game abort', () => {
      renderApp();
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ABCD12',
          playerId: 'p1',
          gameState: fakeGameState,
        });
      });
      expect(screen.queryByText('Create a New Game')).not.toBeInTheDocument();
      act(() => {
        mockSocket._trigger('gameAborted');
      });
      expect(screen.getByText('Create a New Game')).toBeInTheDocument();
    });

    it('attempts reconnection when saved session exists', () => {
      sessionStorage.setItem(
        'skipBoSession',
        JSON.stringify({ roomId: 'OLD123', playerName: 'Alice', sessionToken: 'tok-123' })
      );
      const emitSpy = jest.spyOn(mockSocket, 'emit');
      renderApp();
      act(() => {
        mockSocket._trigger('connect');
      });
      expect(emitSpy).toHaveBeenCalledWith('reconnect', {
        roomId: 'OLD123',
        sessionToken: 'tok-123',
        playerName: 'Alice',
      });
      emitSpy.mockRestore();
    });
  });
});
