import { renderHook, act } from '@testing-library/react';

// --- Socket mock (same pattern as App.test.js) ---
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

const { default: useGameConnection } = require('./useGameConnection');

const fakeGameState = {
  roomId: 'ROOM01',
  players: [
    {
      id: 'test-socket-id',
      name: 'Alice',
      stockpileCount: 10,
      handCount: 5,
      discardPiles: [[], [], [], []],
    },
  ],
  buildingPiles: [[], [], [], []],
  currentPlayerIndex: 0,
  currentPlayerId: 'test-socket-id',
  deckCount: 100,
  gameStarted: false,
  gameOver: false,
  winner: null,
};

const fakePlayerState = {
  hand: [1, 2, 3, 4, 5],
  stockpile: [6, 7, 8],
  stockpileTop: 8,
  discardPiles: [[], [], [], []],
};

beforeEach(() => {
  mockSocket._reset();
  localStorage.clear();
});

describe('useGameConnection', () => {
  describe('initial state', () => {
    it('starts in lobby with null game state', () => {
      const { result } = renderHook(() => useGameConnection());
      expect(result.current.inLobby).toBe(true);
      expect(result.current.gameState).toBeNull();
      expect(result.current.playerState).toBeNull();
      expect(result.current.playerId).toBeNull();
      expect(result.current.roomId).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.chatMessages).toEqual([]);
    });

    it('generates and persists a stablePlayerId', () => {
      const { result } = renderHook(() => useGameConnection());
      expect(result.current.stablePlayerId).toBeTruthy();
      expect(localStorage.getItem('skipBoStablePlayerId')).toBe(result.current.stablePlayerId);
    });

    it('reuses existing stablePlayerId from localStorage', () => {
      localStorage.setItem('skipBoStablePlayerId', 'existing-id');
      const { result } = renderHook(() => useGameConnection());
      expect(result.current.stablePlayerId).toBe('existing-id');
    });
  });

  describe('connection', () => {
    it('sets playerId on connect', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('connect');
      });
      expect(result.current.playerId).toBe('test-socket-id');
    });

    it('attempts reconnect when saved session exists', () => {
      localStorage.setItem(
        'skipBoSession',
        JSON.stringify({ roomId: 'OLD01', playerId: 'old-id', playerName: 'Alice' })
      );
      renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('connect');
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('reconnect', {
        roomId: 'OLD01',
        oldPlayerId: 'old-id',
        playerName: 'Alice',
      });
    });

    it('cleans up by disconnecting on unmount', () => {
      const { unmount } = renderHook(() => useGameConnection());
      unmount();
      expect(mockSocket.close).toHaveBeenCalled();
    });
  });

  describe('roomCreated event', () => {
    it('updates state and leaves lobby', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'test-socket-id',
          gameState: fakeGameState,
        });
      });

      expect(result.current.roomId).toBe('ROOM01');
      expect(result.current.playerId).toBe('test-socket-id');
      expect(result.current.gameState).toEqual(fakeGameState);
      expect(result.current.inLobby).toBe(false);
    });

    it('saves session to localStorage', () => {
      renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'test-socket-id',
          gameState: fakeGameState,
        });
      });

      const session = JSON.parse(localStorage.getItem('skipBoSession'));
      expect(session).toEqual({
        roomId: 'ROOM01',
        playerId: 'test-socket-id',
        playerName: 'Alice',
      });
    });
  });

  describe('playerJoined event', () => {
    it('updates game state', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('playerJoined', { gameState: fakeGameState });
      });
      expect(result.current.gameState).toEqual(fakeGameState);
    });

    it('saves session when connectionId matches a player', () => {
      const { result } = renderHook(() => useGameConnection());
      // First connect to set the connectionIdRef
      act(() => {
        mockSocket._trigger('connect');
      });
      act(() => {
        mockSocket._trigger('playerJoined', { gameState: fakeGameState });
      });

      const session = JSON.parse(localStorage.getItem('skipBoSession'));
      expect(session).toEqual({
        roomId: 'ROOM01',
        playerId: 'test-socket-id',
        playerName: 'Alice',
      });
    });
  });

  describe('reconnected event', () => {
    it('restores full game state', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('reconnected', {
          roomId: 'ROOM01',
          playerId: 'new-id',
          gameState: fakeGameState,
          playerState: fakePlayerState,
        });
      });

      expect(result.current.roomId).toBe('ROOM01');
      expect(result.current.playerId).toBe('new-id');
      expect(result.current.gameState).toEqual(fakeGameState);
      expect(result.current.playerState).toEqual(fakePlayerState);
      expect(result.current.inLobby).toBe(false);
    });
  });

  describe('reconnectFailed event', () => {
    it('clears session and sets error', () => {
      jest.useFakeTimers();
      localStorage.setItem('skipBoSession', JSON.stringify({ roomId: 'OLD01' }));
      const { result } = renderHook(() => useGameConnection());

      act(() => {
        mockSocket._trigger('reconnectFailed', { message: 'error.roomNoLongerExists' });
      });

      expect(result.current.error).toBe('error.roomNoLongerExists');
      expect(localStorage.getItem('skipBoSession')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(result.current.error).toBeNull();
      jest.useRealTimers();
    });
  });

  describe('gameStarted event', () => {
    it('sets game and player state', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('gameStarted', {
          gameState: { ...fakeGameState, gameStarted: true },
          playerState: fakePlayerState,
        });
      });

      expect(result.current.gameState.gameStarted).toBe(true);
      expect(result.current.playerState).toEqual(fakePlayerState);
    });
  });

  describe('gameStateUpdate event', () => {
    it('updates both game and player state', () => {
      const { result } = renderHook(() => useGameConnection());
      const updatedState = { ...fakeGameState, deckCount: 90 };
      const updatedPlayer = { ...fakePlayerState, hand: [1, 2, 3, 4] };

      act(() => {
        mockSocket._trigger('gameStateUpdate', {
          gameState: updatedState,
          playerState: updatedPlayer,
        });
      });

      expect(result.current.gameState.deckCount).toBe(90);
      expect(result.current.playerState.hand).toHaveLength(4);
    });
  });

  describe('gameOver event', () => {
    it('clears session and chat from localStorage', () => {
      localStorage.setItem('skipBoSession', JSON.stringify({ roomId: 'ROOM01' }));
      localStorage.setItem('skipBoChat_ROOM01', JSON.stringify([{ message: 'hi' }]));

      renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('gameOver', { gameState: { ...fakeGameState, gameOver: true } });
      });

      expect(localStorage.getItem('skipBoSession')).toBeNull();
      expect(localStorage.getItem('skipBoChat_ROOM01')).toBeNull();
    });
  });

  describe('playerDisconnected event', () => {
    it('marks the player as disconnected in game state', () => {
      const { result } = renderHook(() => useGameConnection());

      // First set a game state
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'test-socket-id',
          gameState: {
            ...fakeGameState,
            players: [
              { ...fakeGameState.players[0] },
              { id: 'player2', name: 'Bob', disconnected: false },
            ],
          },
        });
      });

      act(() => {
        mockSocket._trigger('playerDisconnected', { playerId: 'player2' });
      });

      const bob = result.current.gameState.players.find((p) => p.id === 'player2');
      expect(bob.disconnected).toBe(true);
    });
  });

  describe('gameAborted event', () => {
    it('resets to lobby state and clears session', () => {
      localStorage.setItem('skipBoSession', JSON.stringify({ roomId: 'ROOM01' }));
      localStorage.setItem('skipBoChat_ROOM01', JSON.stringify([{ message: 'hi' }]));

      const { result } = renderHook(() => useGameConnection());

      // Enter a game first
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'p1',
          gameState: fakeGameState,
        });
      });
      expect(result.current.inLobby).toBe(false);

      act(() => {
        mockSocket._trigger('gameAborted');
      });

      expect(result.current.inLobby).toBe(true);
      expect(result.current.gameState).toBeNull();
      expect(result.current.playerState).toBeNull();
      expect(result.current.roomId).toBeNull();
      expect(result.current.chatMessages).toEqual([]);
      expect(localStorage.getItem('skipBoSession')).toBeNull();
      expect(localStorage.getItem('skipBoChat_ROOM01')).toBeNull();
    });
  });

  describe('chatMessage event', () => {
    it('appends message to chat messages', () => {
      const { result } = renderHook(() => useGameConnection());
      const msg = { playerId: 'p1', playerName: 'Alice', message: 'Hello', timestamp: 12345 };

      act(() => {
        mockSocket._trigger('chatMessage', msg);
      });

      expect(result.current.chatMessages).toEqual([msg]);
    });
  });

  describe('error event', () => {
    it('sets and auto-clears error', () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => useGameConnection());

      act(() => {
        mockSocket._trigger('error', { message: 'error.roomNotFound' });
      });
      expect(result.current.error).toBe('error.roomNotFound');

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(result.current.error).toBeNull();
      jest.useRealTimers();
    });
  });
});
