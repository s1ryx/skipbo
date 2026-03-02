import { createMessageHandlers } from './messageHandlers';

function createMockDeps() {
  const deps = {
    setGameState: jest.fn(),
    setPlayerState: jest.fn(),
    setPlayerId: jest.fn(),
    setRoomId: jest.fn(),
    setInLobby: jest.fn(),
    setError: jest.fn(),
    setRematchVotes: jest.fn(),
    setRematchStockpileSize: jest.fn(),
    setChatMessages: jest.fn(),
    roomIdRef: { current: null },
    sessionTokenRef: { current: null },
  };
  return deps;
}

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();
// eslint-disable-next-line no-undef
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock });

beforeEach(() => {
  sessionStorageMock.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createMessageHandlers', () => {
  describe('roomCreated', () => {
    it('sets room state and saves session', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);
      const gameState = {
        roomId: 'ABC',
        players: [{ id: 'p1', name: 'Alice' }],
      };

      handlers.roomCreated({ roomId: 'ABC', playerId: 'p1', sessionToken: 'tok', gameState });

      expect(deps.setRoomId).toHaveBeenCalledWith('ABC');
      expect(deps.setPlayerId).toHaveBeenCalledWith('p1');
      expect(deps.setGameState).toHaveBeenCalledWith(gameState);
      expect(deps.setInLobby).toHaveBeenCalledWith(false);
      expect(deps.roomIdRef.current).toBe('ABC');
      expect(deps.sessionTokenRef.current).toBe('tok');
      expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
        'skipBoSession',
        expect.stringContaining('Alice')
      );
    });
  });

  describe('playerJoined', () => {
    it('updates game state', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);
      const gameState = { players: [] };

      handlers.playerJoined({ gameState });
      expect(deps.setGameState).toHaveBeenCalledWith(gameState);
    });
  });

  describe('reconnected', () => {
    it('restores full state on reconnect', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);
      const gameState = {
        gameOver: false,
        players: [{ id: 'p1', name: 'Alice' }],
      };
      const playerState = { hand: [1, 2] };

      handlers.reconnected({
        roomId: 'XYZ',
        playerId: 'p1',
        sessionToken: 'tok2',
        gameState,
        playerState,
      });

      expect(deps.setRoomId).toHaveBeenCalledWith('XYZ');
      expect(deps.setPlayerId).toHaveBeenCalledWith('p1');
      expect(deps.setGameState).toHaveBeenCalledWith(gameState);
      expect(deps.setPlayerState).toHaveBeenCalledWith(playerState);
      expect(deps.setInLobby).toHaveBeenCalledWith(false);
    });

    it('restores rematch votes when game is over', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);
      const gameState = {
        gameOver: true,
        rematchVotes: ['p1'],
        players: [{ id: 'p1', name: 'Alice' }],
      };

      handlers.reconnected({
        roomId: 'XYZ',
        playerId: 'p1',
        sessionToken: 'tok',
        gameState,
        playerState: {},
      });

      expect(deps.setRematchVotes).toHaveBeenCalledWith(['p1']);
    });
  });

  describe('reconnectFailed', () => {
    it('clears session and sets error with auto-dismiss', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.reconnectFailed({ message: 'Room not found' });

      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('skipBoSession');
      expect(deps.setError).toHaveBeenCalledWith('Room not found');

      jest.advanceTimersByTime(5000);
      expect(deps.setError).toHaveBeenCalledWith(null);
    });
  });

  describe('gameStarted', () => {
    it('sets game and player state and clears rematch', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);
      const gameState = { players: [] };
      const playerState = { hand: [] };

      handlers.gameStarted({ gameState, playerState });

      expect(deps.setGameState).toHaveBeenCalledWith(gameState);
      expect(deps.setPlayerState).toHaveBeenCalledWith(playerState);
      expect(deps.setRematchVotes).toHaveBeenCalledWith([]);
      expect(deps.setRematchStockpileSize).toHaveBeenCalledWith(null);
    });
  });

  describe('gameStateUpdate', () => {
    it('updates game and player state', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.gameStateUpdate({ gameState: 'gs', playerState: 'ps' });

      expect(deps.setGameState).toHaveBeenCalledWith('gs');
      expect(deps.setPlayerState).toHaveBeenCalledWith('ps');
    });
  });

  describe('gameOver', () => {
    it('clears session storage', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.gameOver({ gameState: { winner: 'p1' } });

      expect(deps.setGameState).toHaveBeenCalled();
      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('skipBoSession');
    });
  });

  describe('gameAborted', () => {
    it('resets all state to initial values', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.gameAborted();

      expect(deps.setGameState).toHaveBeenCalledWith(null);
      expect(deps.setPlayerState).toHaveBeenCalledWith(null);
      expect(deps.setRoomId).toHaveBeenCalledWith(null);
      expect(deps.setInLobby).toHaveBeenCalledWith(true);
      expect(deps.setChatMessages).toHaveBeenCalledWith([]);
      expect(deps.setRematchVotes).toHaveBeenCalledWith([]);
      expect(deps.setRematchStockpileSize).toHaveBeenCalledWith(null);
      expect(deps.roomIdRef.current).toBeNull();
    });
  });

  describe('playerDisconnected', () => {
    it('marks player as disconnected', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.playerDisconnected({ playerId: 'p2' });

      const updater = deps.setGameState.mock.calls[0][0];
      const prevState = { players: [{ id: 'p1' }, { id: 'p2' }] };
      const newState = updater(prevState);
      expect(newState.players[1].disconnected).toBe(true);
      expect(newState.players[0].disconnected).toBeUndefined();
    });
  });

  describe('playerReconnected', () => {
    it('marks player as reconnected', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.playerReconnected({ playerId: 'p2' });

      const updater = deps.setGameState.mock.calls[0][0];
      const prevState = { players: [{ id: 'p1' }, { id: 'p2', disconnected: true }] };
      const newState = updater(prevState);
      expect(newState.players[1].disconnected).toBe(false);
    });
  });

  describe('rematchVoteUpdate', () => {
    it('updates rematch votes and stockpile size', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.rematchVoteUpdate({ rematchVotes: ['p1'], stockpileSize: 30 });

      expect(deps.setRematchVotes).toHaveBeenCalledWith(['p1']);
      expect(deps.setRematchStockpileSize).toHaveBeenCalledWith(30);
    });
  });

  describe('chatMessage', () => {
    it('appends message to chat', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);
      const msg = { playerId: 'p1', message: 'hi' };

      handlers.chatMessage(msg);

      const updater = deps.setChatMessages.mock.calls[0][0];
      const result = updater([{ playerId: 'p2', message: 'old' }]);
      expect(result).toHaveLength(2);
      expect(result[1]).toBe(msg);
    });
  });

  describe('error', () => {
    it('sets and auto-dismisses error', () => {
      const deps = createMockDeps();
      const handlers = createMessageHandlers(deps);

      handlers.error({ message: 'Something went wrong' });

      expect(deps.setError).toHaveBeenCalledWith('Something went wrong');
      jest.advanceTimersByTime(3000);
      expect(deps.setError).toHaveBeenCalledWith(null);
    });
  });
});
