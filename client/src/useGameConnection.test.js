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
  stockpileCount: 3,
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
        JSON.stringify({ roomId: 'OLD01', playerName: 'Alice', sessionToken: 'tok-123' })
      );
      renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('connect');
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('reconnect', {
        roomId: 'OLD01',
        sessionToken: 'tok-123',
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
          sessionToken: 'tok-abc',
          gameState: fakeGameState,
        });
      });

      expect(result.current.roomId).toBe('ROOM01');
      expect(result.current.playerId).toBe('test-socket-id');
      expect(result.current.gameState).toEqual(fakeGameState);
      expect(result.current.inLobby).toBe(false);
    });

    it('saves session with token to localStorage', () => {
      renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'test-socket-id',
          sessionToken: 'tok-abc',
          gameState: fakeGameState,
        });
      });

      const session = JSON.parse(localStorage.getItem('skipBoSession'));
      expect(session).toEqual({
        roomId: 'ROOM01',
        playerId: 'test-socket-id',
        playerName: 'Alice',
        sessionToken: 'tok-abc',
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

    it('does not change room state on its own', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('connect');
      });

      act(() => {
        mockSocket._trigger('playerJoined', { gameState: fakeGameState });
      });
      expect(result.current.inLobby).toBe(true);
      expect(result.current.roomId).toBeNull();
    });
  });

  describe('sessionToken event', () => {
    it('sets room state and saves session for joining player', () => {
      const gameStateWithPubId = {
        ...fakeGameState,
        players: [{ ...fakeGameState.players[0], id: 'pub-123' }],
      };
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('connect');
      });
      // First receive playerJoined with gameState
      act(() => {
        mockSocket._trigger('playerJoined', { gameState: gameStateWithPubId });
      });
      // Then receive sessionToken targeted to us
      act(() => {
        mockSocket._trigger('sessionToken', {
          playerId: 'pub-123',
          sessionToken: 'tok-456',
        });
      });

      expect(result.current.playerId).toBe('pub-123');
      expect(result.current.roomId).toBe('ROOM01');
      expect(result.current.inLobby).toBe(false);

      const session = JSON.parse(localStorage.getItem('skipBoSession'));
      expect(session.roomId).toBe('ROOM01');
      expect(session.playerId).toBe('pub-123');
      expect(session.sessionToken).toBe('tok-456');
    });
  });

  describe('reconnected event', () => {
    it('restores full game state with new session token', () => {
      const reconnectGameState = {
        ...fakeGameState,
        players: [{ ...fakeGameState.players[0], id: 'new-id' }],
      };
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        mockSocket._trigger('reconnected', {
          roomId: 'ROOM01',
          playerId: 'new-id',
          sessionToken: 'new-tok',
          gameState: reconnectGameState,
          playerState: fakePlayerState,
        });
      });

      expect(result.current.roomId).toBe('ROOM01');
      expect(result.current.playerId).toBe('new-id');
      expect(result.current.gameState).toEqual(reconnectGameState);
      expect(result.current.playerState).toEqual(fakePlayerState);
      expect(result.current.inLobby).toBe(false);

      const session = JSON.parse(localStorage.getItem('skipBoSession'));
      expect(session.sessionToken).toBe('new-tok');
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

  describe('playerReconnected event', () => {
    it('clears the disconnected flag for the player', () => {
      const { result } = renderHook(() => useGameConnection());

      // First set a game state with a disconnected player
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'test-socket-id',
          gameState: {
            ...fakeGameState,
            players: [
              { ...fakeGameState.players[0] },
              { id: 'player2', name: 'Bob', disconnected: true },
            ],
          },
        });
      });

      act(() => {
        mockSocket._trigger('playerReconnected', { playerId: 'player2' });
      });

      const bob = result.current.gameState.players.find((p) => p.id === 'player2');
      expect(bob.disconnected).toBe(false);
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

  describe('action functions', () => {
    it('createRoom sends the correct event', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        result.current.createRoom('Alice', 4, 20);
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('createRoom', {
        playerName: 'Alice',
        maxPlayers: 4,
        stockpileSize: 20,
      });
    });

    it('joinRoom sends event without changing local state', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        result.current.joinRoom('ROOM01', 'Alice');
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('joinRoom', {
        roomId: 'ROOM01',
        playerName: 'Alice',
      });
      expect(result.current.inLobby).toBe(true);
      expect(result.current.roomId).toBeNull();
    });

    it('startGame sends the correct event', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        result.current.startGame();
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('startGame', undefined);
    });

    it('playCard sends the correct event', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        result.current.playCard(5, 'hand', 0);
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('playCard', {
        card: 5,
        source: 'hand',
        buildingPileIndex: 0,
      });
    });

    it('discardCard sends the correct event', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        result.current.discardCard(3, 2);
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('discardCard', {
        card: 3,
        discardPileIndex: 2,
      });
    });

    it('leaveLobby sends event and resets state', () => {
      const { result } = renderHook(() => useGameConnection());

      // Simulate a confirmed room join via server events
      act(() => {
        mockSocket._trigger('connect');
      });
      act(() => {
        mockSocket._trigger('playerJoined', { gameState: fakeGameState });
      });
      act(() => {
        mockSocket._trigger('sessionToken', { playerId: 'pub-1', sessionToken: 'tok-1' });
      });
      expect(result.current.inLobby).toBe(false);

      act(() => {
        result.current.leaveLobby();
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('leaveLobby', undefined);
      expect(result.current.inLobby).toBe(true);
      expect(result.current.gameState).toBeNull();
      expect(result.current.roomId).toBeNull();
      expect(localStorage.getItem('skipBoSession')).toBeNull();
    });

    it('leaveGame sends event and clears chat from localStorage', () => {
      const { result } = renderHook(() => useGameConnection());

      // Enter a room first (sets roomIdRef)
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'p1',
          sessionToken: 'tok-1',
          gameState: fakeGameState,
        });
      });
      localStorage.setItem('skipBoChat_ROOM01', JSON.stringify([{ message: 'hi' }]));

      act(() => {
        result.current.leaveGame();
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('leaveGame', undefined);
      expect(localStorage.getItem('skipBoChat_ROOM01')).toBeNull();
    });

    it('sendChatMessage sends event with stablePlayerId', () => {
      const { result } = renderHook(() => useGameConnection());
      act(() => {
        result.current.sendChatMessage('Hello!');
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('sendChatMessage', {
        message: 'Hello!',
        stablePlayerId: result.current.stablePlayerId,
      });
    });

    it('markMessagesAsRead marks all messages as read', () => {
      const { result } = renderHook(() => useGameConnection());

      act(() => {
        mockSocket._trigger('chatMessage', { message: 'hi', read: false });
        mockSocket._trigger('chatMessage', { message: 'bye', read: false });
      });
      expect(result.current.chatMessages).toHaveLength(2);

      act(() => {
        result.current.markMessagesAsRead();
      });
      result.current.chatMessages.forEach((msg) => {
        expect(msg.read).toBe(true);
      });
    });
  });

  describe('chat persistence', () => {
    it('loads chat messages from localStorage on init', () => {
      localStorage.setItem('skipBoSession', JSON.stringify({ roomId: 'ROOM01' }));
      localStorage.setItem(
        'skipBoChat_ROOM01',
        JSON.stringify([{ message: 'saved msg', read: true }])
      );

      const { result } = renderHook(() => useGameConnection());
      expect(result.current.chatMessages).toEqual([{ message: 'saved msg', read: true }]);
    });

    it('saves chat messages to localStorage when they change', () => {
      const { result } = renderHook(() => useGameConnection());

      // Set roomId first
      act(() => {
        mockSocket._trigger('roomCreated', {
          roomId: 'ROOM01',
          playerId: 'p1',
          gameState: fakeGameState,
        });
      });

      act(() => {
        mockSocket._trigger('chatMessage', { message: 'new msg' });
      });

      const saved = JSON.parse(localStorage.getItem('skipBoChat_ROOM01'));
      expect(saved).toEqual([{ message: 'new msg' }]);
    });
  });
});
