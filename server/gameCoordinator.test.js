const GameCoordinator = require('./gameCoordinator');

function createMockTransport() {
  return {
    send: jest.fn(),
    sendToGroup: jest.fn(),
    sendToGroupExcept: jest.fn(),
    addToGroup: jest.fn(),
    removeFromGroup: jest.fn(),
  };
}

function createCoordinator() {
  const coordinator = new GameCoordinator();
  const transport = createMockTransport();
  coordinator.setTransport(transport);
  return { coordinator, transport };
}

/** Helper: create a room via the coordinator, returns the roomId */
function createRoom(coordinator, connectionId = 'player1', playerName = 'Alice') {
  const handlers = coordinator.getTransportHandlers();
  handlers.onMessage(connectionId, 'createRoom', {
    playerName,
    maxPlayers: 2,
    stockpileSize: null,
  });
  const call = coordinator.transport.send.mock.calls.find(
    (c) => c[0] === connectionId && c[1] === 'roomCreated'
  );
  return call[2].roomId;
}

/** Helper: create a room and have a second player join */
function createRoomWithTwoPlayers(coordinator) {
  const roomId = createRoom(coordinator, 'player1', 'Alice');
  const handlers = coordinator.getTransportHandlers();
  handlers.onMessage('player2', 'joinRoom', { roomId, playerName: 'Bob' });
  return roomId;
}

/** Helper: create a room, add two players, and start the game */
function createStartedGame(coordinator) {
  const roomId = createRoomWithTwoPlayers(coordinator);
  const handlers = coordinator.getTransportHandlers();
  handlers.onMessage('player1', 'startGame', {});
  return roomId;
}

describe('GameCoordinator', () => {
  describe('initialization', () => {
    it('starts with empty state', () => {
      const coordinator = new GameCoordinator();
      expect(coordinator.games.size).toBe(0);
      expect(coordinator.playerRooms.size).toBe(0);
      expect(coordinator.pendingDeletions.size).toBe(0);
    });

    it('stores the transport via setTransport', () => {
      const { coordinator, transport } = createCoordinator();
      expect(coordinator.transport).toBe(transport);
    });

    it('returns bound handlers from getTransportHandlers', () => {
      const { coordinator } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();
      expect(typeof handlers.onConnect).toBe('function');
      expect(typeof handlers.onDisconnect).toBe('function');
      expect(typeof handlers.onMessage).toBe('function');
    });
  });

  describe('handleMessage routing', () => {
    it('routes known events to handler methods', () => {
      const { coordinator } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      const spy = jest.spyOn(coordinator, 'handleCreateRoom');
      handlers.onMessage('p1', 'createRoom', { playerName: 'X', maxPlayers: 2 });
      expect(spy).toHaveBeenCalledWith('p1', { playerName: 'X', maxPlayers: 2 });
      spy.mockRestore();
    });

    it('logs unknown events without crashing', () => {
      const { coordinator } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();
      expect(() => handlers.onMessage('p1', 'unknownEvent', {})).not.toThrow();
    });
  });

  describe('createRoom', () => {
    it('creates a game and tracks the player', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoom(coordinator);

      expect(coordinator.games.size).toBe(1);
      expect(coordinator.playerRooms.get('player1')).toBe(roomId);
    });

    it('adds the player to the transport group', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoom(coordinator);
      expect(transport.addToGroup).toHaveBeenCalledWith('player1', roomId);
    });

    it('sends roomCreated to the player', () => {
      const { coordinator, transport } = createCoordinator();
      createRoom(coordinator);

      const call = transport.send.mock.calls.find((c) => c[1] === 'roomCreated');
      expect(call[0]).toBe('player1');
      expect(call[2]).toHaveProperty('roomId');
      expect(call[2].playerId).toBe('player1');
      expect(call[2].gameState).toBeDefined();
    });

    it('generates a 6-character room ID', () => {
      const { coordinator } = createCoordinator();
      const roomId = createRoom(coordinator);
      expect(roomId).toHaveLength(6);
    });

    it('rejects non-string player name', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('p1', 'createRoom', { playerName: 123, maxPlayers: 2 });
      expect(transport.send).toHaveBeenCalledWith('p1', 'error', {
        message: 'error.invalidPlayerName',
      });
      expect(coordinator.games.size).toBe(0);
    });

    it('rejects empty player name', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('p1', 'createRoom', { playerName: '   ', maxPlayers: 2 });
      expect(transport.send).toHaveBeenCalledWith('p1', 'error', {
        message: 'error.invalidPlayerName',
      });
    });

    it('rejects player name exceeding 30 characters', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('p1', 'createRoom', { playerName: 'A'.repeat(31), maxPlayers: 2 });
      expect(transport.send).toHaveBeenCalledWith('p1', 'error', {
        message: 'error.invalidPlayerName',
      });
    });

    it('strips control characters from player name', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('p1', 'createRoom', { playerName: 'Al\x00ic\x1Fe', maxPlayers: 2 });
      expect(coordinator.games.size).toBe(1);
      const game = [...coordinator.games.values()][0];
      expect(game.players[0].name).toBe('Alice');
    });

    it('strips HTML tags from player name', () => {
      const { coordinator } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('p1', 'createRoom', { playerName: '<b>Bold</b>', maxPlayers: 2 });
      const game = [...coordinator.games.values()][0];
      expect(game.players[0].name).toBe('Bold');
    });

    it('rejects name that becomes empty after HTML stripping', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('p1', 'createRoom', {
        playerName: '<br><hr>',
        maxPlayers: 2,
      });
      expect(coordinator.games.size).toBe(0);
      expect(transport.send).toHaveBeenCalledWith('p1', 'error', {
        message: 'error.invalidPlayerName',
      });
    });
    it('clamps maxPlayers to valid range', () => {
      const { coordinator } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      // Too low
      handlers.onMessage('p1', 'createRoom', { playerName: 'A', maxPlayers: 0 });
      let game = [...coordinator.games.values()][0];
      expect(game.playerCount).toBe(2);

      // Too high
      handlers.onMessage('p2', 'createRoom', { playerName: 'B', maxPlayers: 7 });
      game = [...coordinator.games.values()][1];
      expect(game.playerCount).toBe(2);

      // NaN / float / string
      handlers.onMessage('p3', 'createRoom', { playerName: 'C', maxPlayers: 2.5 });
      game = [...coordinator.games.values()][2];
      expect(game.playerCount).toBe(2);

      // Valid
      handlers.onMessage('p4', 'createRoom', { playerName: 'D', maxPlayers: 4 });
      game = [...coordinator.games.values()][3];
      expect(game.playerCount).toBe(4);
    });

    it('clamps stockpileSize to valid range', () => {
      const { coordinator } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      // Invalid → undefined (uses game default)
      handlers.onMessage('p1', 'createRoom', { playerName: 'A', maxPlayers: 2, stockpileSize: -1 });
      let game = [...coordinator.games.values()][0];
      expect(game.stockpileSize).toBeUndefined();

      handlers.onMessage('p2', 'createRoom', { playerName: 'B', maxPlayers: 2, stockpileSize: 31 });
      game = [...coordinator.games.values()][1];
      expect(game.stockpileSize).toBeUndefined();

      // Valid
      handlers.onMessage('p3', 'createRoom', { playerName: 'C', maxPlayers: 2, stockpileSize: 10 });
      game = [...coordinator.games.values()][2];
      expect(game.stockpileSize).toBe(10);
    });
  });

  describe('joinRoom', () => {
    it('adds a second player to the game', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player2', 'joinRoom', { roomId, playerName: 'Bob' });

      expect(coordinator.playerRooms.get('player2')).toBe(roomId);
      expect(transport.addToGroup).toHaveBeenCalledWith('player2', roomId);
    });

    it('broadcasts playerJoined to the room', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player2', 'joinRoom', { roomId, playerName: 'Bob' });

      expect(transport.sendToGroup).toHaveBeenCalledWith(
        roomId,
        'playerJoined',
        expect.objectContaining({ playerId: 'player2', playerName: 'Bob' })
      );
    });

    it('sends error when room does not exist', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player2', 'joinRoom', { roomId: 'NOPE00', playerName: 'Bob' });

      expect(transport.send).toHaveBeenCalledWith('player2', 'error', {
        message: 'error.roomNotFound',
      });
    });

    it('sends error when game already started', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player3', 'joinRoom', { roomId, playerName: 'Eve' });

      expect(transport.send).toHaveBeenCalledWith('player3', 'error', {
        message: 'error.gameAlreadyStarted',
      });
    });

    it('sends error when room is full', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player3', 'joinRoom', { roomId, playerName: 'Eve' });

      expect(transport.send).toHaveBeenCalledWith('player3', 'error', {
        message: 'error.roomFull',
      });
    });

    it('rejects invalid player name on join', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player2', 'joinRoom', { roomId, playerName: null });
      expect(transport.send).toHaveBeenCalledWith('player2', 'error', {
        message: 'error.invalidPlayerName',
      });
    });

    it('cancels pending deletion when a player joins', () => {
      const { coordinator } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      // Leave to trigger pending deletion
      handlers.onMessage('player1', 'leaveLobby', {});
      expect(coordinator.pendingDeletions.has(roomId)).toBe(true);

      // Re-add and join with new player — should cancel deletion
      // The room still exists because of grace period
      handlers.onMessage('player2', 'joinRoom', { roomId, playerName: 'Bob' });
      expect(coordinator.pendingDeletions.has(roomId)).toBe(false);
    });
  });

  describe('startGame', () => {
    it('starts the game and sends gameStarted to each player', () => {
      const { coordinator, transport } = createCoordinator();
      createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player1', 'startGame', {});

      const gameStartedCalls = transport.send.mock.calls.filter((c) => c[1] === 'gameStarted');
      expect(gameStartedCalls).toHaveLength(2);

      // Each player receives their own playerState
      const p1Call = gameStartedCalls.find((c) => c[0] === 'player1');
      const p2Call = gameStartedCalls.find((c) => c[0] === 'player2');
      expect(p1Call[2].playerState).toBeDefined();
      expect(p2Call[2].playerState).toBeDefined();
    });

    it('sends error when room not found', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('unknown', 'startGame', {});

      expect(transport.send).toHaveBeenCalledWith('unknown', 'error', {
        message: 'error.roomNotFound',
      });
    });

    it('sends error when not enough players', () => {
      const { coordinator, transport } = createCoordinator();
      createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player1', 'startGame', {});

      expect(transport.send).toHaveBeenCalledWith('player1', 'error', {
        message: 'error.needMorePlayers',
      });
    });
  });

  describe('playCard', () => {
    it('sends error when room not found', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('unknown', 'playCard', { card: 1, source: 'hand', buildingPileIndex: 0 });

      expect(transport.send).toHaveBeenCalledWith('unknown', 'error', {
        message: 'error.roomNotFound',
      });
    });

    it('broadcasts gameStateUpdate on valid play', () => {
      const { coordinator, transport } = createCoordinator();
      createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      // Inject a known card into player1's hand so the test is deterministic
      const game = [...coordinator.games.values()][0];
      const player1 = game.players.find((p) => p.id === 'player1');
      player1.hand[0] = 1;

      transport.send.mockClear();
      handlers.onMessage('player1', 'playCard', {
        card: 1,
        source: 'hand',
        buildingPileIndex: 0,
      });

      const updateCalls = transport.send.mock.calls.filter((c) => c[1] === 'gameStateUpdate');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('sends error on invalid move', () => {
      const { coordinator, transport } = createCoordinator();
      createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.send.mockClear();
      // Playing a 5 on an empty pile (needs 1) should fail
      handlers.onMessage('player1', 'playCard', {
        card: 5,
        source: 'hand',
        buildingPileIndex: 0,
      });

      expect(transport.send).toHaveBeenCalledWith('player1', 'error', expect.any(Object));
    });
  });

  describe('discardCard', () => {
    it('sends error when room not found', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('unknown', 'discardCard', { card: 1, discardPileIndex: 0 });

      expect(transport.send).toHaveBeenCalledWith('unknown', 'error', {
        message: 'error.roomNotFound',
      });
    });

    it('broadcasts gameStateUpdate and turnChanged on valid discard', () => {
      const { coordinator, transport } = createCoordinator();
      createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      const game = [...coordinator.games.values()][0];
      const player1 = game.players.find((p) => p.id === 'player1');
      const card = player1.hand[0];

      transport.send.mockClear();
      transport.sendToGroup.mockClear();
      handlers.onMessage('player1', 'discardCard', { card, discardPileIndex: 0 });

      const updateCalls = transport.send.mock.calls.filter((c) => c[1] === 'gameStateUpdate');
      expect(updateCalls).toHaveLength(2); // one per player

      expect(transport.sendToGroup).toHaveBeenCalledWith(
        expect.any(String),
        'turnChanged',
        expect.objectContaining({ currentPlayerId: 'player2' })
      );
    });
  });

  describe('sendChatMessage', () => {
    it('broadcasts chat message to the room', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('player1', 'sendChatMessage', {
        message: 'Hello!',
        stablePlayerId: 'stable-1',
      });

      expect(transport.sendToGroup).toHaveBeenCalledWith(
        roomId,
        'chatMessage',
        expect.objectContaining({
          playerId: 'player1',
          playerName: 'Alice',
          stablePlayerId: 'stable-1',
          message: 'Hello!',
          timestamp: expect.any(Number),
        })
      );
    });

    it('trims whitespace from messages', () => {
      const { coordinator, transport } = createCoordinator();
      createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('player1', 'sendChatMessage', {
        message: '  Hello!  ',
        stablePlayerId: 'stable-1',
      });

      const call = transport.sendToGroup.mock.calls.find((c) => c[1] === 'chatMessage');
      expect(call[2].message).toBe('Hello!');
    });

    it('silently ignores when player has no room', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('unknown', 'sendChatMessage', { message: 'Hi', stablePlayerId: 's1' });
      expect(transport.sendToGroup).not.toHaveBeenCalled();
    });

    it('silently ignores non-string message', () => {
      const { coordinator, transport } = createCoordinator();
      createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('player1', 'sendChatMessage', { message: 123, stablePlayerId: 's1' });
      expect(transport.sendToGroup).not.toHaveBeenCalled();
    });

    it('silently ignores empty message', () => {
      const { coordinator, transport } = createCoordinator();
      createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('player1', 'sendChatMessage', { message: '   ', stablePlayerId: 's1' });
      expect(transport.sendToGroup).not.toHaveBeenCalled();
    });

    it('silently ignores message exceeding 500 characters', () => {
      const { coordinator, transport } = createCoordinator();
      createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('player1', 'sendChatMessage', {
        message: 'A'.repeat(501),
        stablePlayerId: 's1',
      });
      expect(transport.sendToGroup).not.toHaveBeenCalled();
    });

    it('strips HTML tags from chat message', () => {
      const { coordinator, transport } = createCoordinator();
      createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('player1', 'sendChatMessage', {
        message: 'Hello <b>world</b>',
        stablePlayerId: 's1',
      });
      expect(transport.sendToGroup).toHaveBeenCalledWith(
        expect.any(String),
        'chatMessage',
        expect.objectContaining({ message: 'Hello world' })
      );
    });
  });

  describe('leaveLobby', () => {
    it('removes the player and notifies remaining players', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('player2', 'leaveLobby', {});

      expect(coordinator.playerRooms.has('player2')).toBe(false);
      expect(transport.removeFromGroup).toHaveBeenCalledWith('player2', roomId);
      expect(transport.sendToGroup).toHaveBeenCalledWith(
        roomId,
        'playerLeft',
        expect.objectContaining({ playerId: 'player2' })
      );
    });

    it('schedules room deletion when last player leaves', () => {
      jest.useFakeTimers();
      const { coordinator } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player1', 'leaveLobby', {});

      expect(coordinator.pendingDeletions.has(roomId)).toBe(true);
      expect(coordinator.games.has(roomId)).toBe(true);

      jest.advanceTimersByTime(30000);

      expect(coordinator.games.has(roomId)).toBe(false);
      expect(coordinator.pendingDeletions.has(roomId)).toBe(false);
      jest.useRealTimers();
    });

    it('does nothing if game already started', () => {
      const { coordinator, transport } = createCoordinator();
      createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      const gamesBefore = coordinator.games.size;
      transport.removeFromGroup.mockClear();
      handlers.onMessage('player1', 'leaveLobby', {});

      expect(coordinator.games.size).toBe(gamesBefore);
      expect(transport.removeFromGroup).not.toHaveBeenCalled();
    });
  });

  describe('leaveGame', () => {
    it('aborts the game and notifies all players', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player1', 'leaveGame', {});

      expect(transport.sendToGroup).toHaveBeenCalledWith(roomId, 'gameAborted');
      expect(coordinator.games.has(roomId)).toBe(false);
      expect(coordinator.playerRooms.has('player1')).toBe(false);
      expect(coordinator.playerRooms.has('player2')).toBe(false);
    });

    it('does nothing if player has no room', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onMessage('unknown', 'leaveGame', {});

      expect(transport.sendToGroup).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('removes player from lobby and notifies others', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onDisconnect('player2');

      expect(coordinator.playerRooms.has('player2')).toBe(false);
      expect(transport.sendToGroup).toHaveBeenCalledWith(
        roomId,
        'playerLeft',
        expect.objectContaining({ playerId: 'player2' })
      );
    });

    it('schedules room deletion when last player disconnects from lobby', () => {
      jest.useFakeTimers();
      const { coordinator } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      handlers.onDisconnect('player1');

      expect(coordinator.pendingDeletions.has(roomId)).toBe(true);

      jest.advanceTimersByTime(30000);
      expect(coordinator.games.has(roomId)).toBe(false);
      jest.useRealTimers();
    });

    it('notifies playerDisconnected during active game', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onDisconnect('player2');

      expect(transport.sendToGroup).toHaveBeenCalledWith(roomId, 'playerDisconnected', {
        playerId: 'player2',
      });
      // Game should still exist (allows reconnection)
      expect(coordinator.games.has(roomId)).toBe(true);
    });

    it('cleans up playerRooms when game is missing', () => {
      const { coordinator } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      // Manually delete the game to simulate edge case
      coordinator.games.delete(roomId);

      handlers.onDisconnect('player1');
      expect(coordinator.playerRooms.has('player1')).toBe(false);
    });

    it('does nothing for unknown player', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      transport.sendToGroup.mockClear();
      handlers.onDisconnect('unknown');
      expect(transport.sendToGroup).not.toHaveBeenCalled();
    });
  });

  describe('reconnect', () => {
    it('reconnects a player to an active game', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      // Simulate disconnect
      handlers.onDisconnect('player2');

      transport.send.mockClear();
      transport.addToGroup.mockClear();
      handlers.onMessage('player2-new', 'reconnect', {
        roomId,
        oldPlayerId: 'player2',
        playerName: 'Bob',
      });

      expect(transport.send).toHaveBeenCalledWith(
        'player2-new',
        'reconnected',
        expect.objectContaining({
          roomId,
          playerId: 'player2-new',
          gameState: expect.any(Object),
          playerState: expect.any(Object),
        })
      );
      expect(transport.addToGroup).toHaveBeenCalledWith('player2-new', roomId);
      expect(transport.sendToGroupExcept).toHaveBeenCalledWith(
        roomId,
        'player2-new',
        'playerReconnected',
        expect.objectContaining({ playerId: 'player2-new', playerName: 'Bob' })
      );
    });

    it('rejoins lobby when player was removed pre-game', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.send.mockClear();
      handlers.onMessage('player2-new', 'reconnect', {
        roomId,
        oldPlayerId: 'player2-old',
        playerName: 'Bob',
      });

      expect(transport.send).toHaveBeenCalledWith(
        'player2-new',
        'reconnected',
        expect.objectContaining({ roomId, playerId: 'player2-new' })
      );
      expect(transport.sendToGroupExcept).toHaveBeenCalledWith(
        roomId,
        'player2-new',
        'playerJoined',
        expect.objectContaining({ playerId: 'player2-new', playerName: 'Bob' })
      );
    });

    it('fails when room does not exist', () => {
      const { coordinator, transport } = createCoordinator();
      const handlers = coordinator.getTransportHandlers();

      handlers.onMessage('player1', 'reconnect', {
        roomId: 'GONE00',
        oldPlayerId: 'old-id',
        playerName: 'Alice',
      });

      expect(transport.send).toHaveBeenCalledWith('player1', 'reconnectFailed', {
        message: 'error.roomNoLongerExists',
      });
    });

    it('fails when player not found and game already started', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createStartedGame(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.send.mockClear();
      handlers.onMessage('unknown-new', 'reconnect', {
        roomId,
        oldPlayerId: 'never-existed',
        playerName: 'Eve',
      });

      expect(transport.send).toHaveBeenCalledWith('unknown-new', 'reconnectFailed', {
        message: 'error.playerNotFound',
      });
    });

    it('fails when room is full on lobby rejoin', () => {
      const { coordinator, transport } = createCoordinator();
      const roomId = createRoomWithTwoPlayers(coordinator);
      const handlers = coordinator.getTransportHandlers();

      transport.send.mockClear();
      handlers.onMessage('player3-new', 'reconnect', {
        roomId,
        oldPlayerId: 'player3-old',
        playerName: 'Eve',
      });

      expect(transport.send).toHaveBeenCalledWith('player3-new', 'reconnectFailed', {
        message: 'error.roomFull',
      });
    });
  });

  describe('scheduleRoomDeletion', () => {
    it('deletes room immediately when pending limit reached', () => {
      const { coordinator } = createCoordinator();
      const roomId = createRoom(coordinator);
      const handlers = coordinator.getTransportHandlers();

      // Fill up pending deletions to the limit
      for (let i = 0; i < 50; i++) {
        coordinator.pendingDeletions.set(`fake-room-${i}`, setTimeout(() => {}, 99999));
      }

      handlers.onMessage('player1', 'leaveLobby', {});

      // Room should be deleted immediately, not scheduled
      expect(coordinator.games.has(roomId)).toBe(false);
      expect(coordinator.pendingDeletions.has(roomId)).toBe(false);

      // Clean up fake timers
      for (const [, timeoutId] of coordinator.pendingDeletions) {
        clearTimeout(timeoutId);
      }
    });
  });
});
