import debugLog from './debugLog';

// The only reconnect failure that is unrecoverable for sure: the room itself
// is gone. Every other code may be transient -- room could free up, server
// could come back, token could become valid again after a retry -- so we
// keep localStorage and let the user (or a manual leaveLobby) decide.
const PERMANENT_RECONNECT_FAILURES = new Set(['error.roomNoLongerExists']);

export function createMessageHandlers({
  setGameState,
  setPlayerState,
  setPlayerId,
  setRoomId,
  setInLobby,
  setError,
  setChatMessages,
  roomIdRef,
  sessionTokenRef,
}) {
  function saveSession(roomId, playerId, playerName, sessionToken) {
    debugLog('session', 'save', {
      roomId,
      playerId,
      playerName,
      hasToken: !!sessionToken,
    });
    localStorage.setItem(
      'skipBoSession',
      JSON.stringify({ roomId, playerId, playerName, sessionToken })
    );
  }

  function clearSession(reason) {
    debugLog('session', 'clear', {
      reason,
      hadSession: !!localStorage.getItem('skipBoSession'),
    });
    localStorage.removeItem('skipBoSession');
  }

  return {
    roomCreated({ roomId, playerId, sessionToken, gameState }) {
      debugLog('event', 'roomCreated', { roomId, playerId });
      roomIdRef.current = roomId;
      sessionTokenRef.current = sessionToken;
      setRoomId(roomId);
      setPlayerId(playerId);
      setGameState(gameState);
      setInLobby(false);

      const player = gameState.players.find((p) => p.id === playerId);
      if (player) {
        saveSession(roomId, playerId, player.name, sessionToken);
      }
    },

    playerJoined({ gameState }) {
      debugLog('event', 'playerJoined', { players: gameState?.players?.length });
      setGameState(gameState);
    },

    sessionToken({ playerId, sessionToken }) {
      debugLog('event', 'sessionToken', { playerId, hasToken: !!sessionToken });
      sessionTokenRef.current = sessionToken;
      setPlayerId(playerId);
      setGameState((prev) => {
        if (!prev) return prev;
        roomIdRef.current = prev.roomId;
        setRoomId(prev.roomId);
        setInLobby(false);
        const player = prev.players.find((p) => p.id === playerId);
        if (player) {
          saveSession(prev.roomId, playerId, player.name, sessionToken);
        }
        return prev;
      });
    },

    playerLeft({ gameState }) {
      debugLog('event', 'playerLeft', { players: gameState?.players?.length });
      setGameState(gameState);
    },

    reconnected({ roomId, playerId, sessionToken, gameState, playerState }) {
      debugLog('event', 'reconnected', {
        roomId,
        playerId,
        gameStarted: !!gameState?.gameStarted,
        gameOver: !!gameState?.gameOver,
      });
      roomIdRef.current = roomId;
      sessionTokenRef.current = sessionToken;
      setRoomId(roomId);
      setPlayerId(playerId);
      setGameState(gameState);
      setPlayerState(playerState);
      setInLobby(false);

      const player = gameState.players.find((p) => p.id === playerId);
      if (player) {
        saveSession(roomId, playerId, player.name, sessionToken);
      }
    },

    reconnectFailed({ message }) {
      const permanent = PERMANENT_RECONNECT_FAILURES.has(message);
      debugLog('event', 'reconnectFailed', { message, permanent });
      if (permanent) {
        clearSession('reconnectFailed-permanent');
      }
      setError(message);
      setTimeout(() => setError(null), 5000);
    },

    gameStarted({ gameState, playerState }) {
      debugLog('event', 'gameStarted', {
        players: gameState?.players?.length,
        hasPlayerState: !!playerState,
      });
      setGameState(gameState);
      setPlayerState(playerState);
    },

    gameStateUpdate({ gameState, playerState }) {
      setGameState(gameState);
      setPlayerState(playerState);
    },

    gameOver({ gameState }) {
      debugLog('event', 'gameOver', { winner: gameState?.winner });
      setGameState(gameState);
      // Keep the session token and chat: the game stays in memory and the
      // players return to the waiting room together. Clearing here broke
      // reconnect after a post-game tab-out. Explicit-leave paths
      // (gameAborted, leaveGame) are what clear the session.
    },

    playerDisconnected({ playerId }) {
      debugLog('event', 'playerDisconnected', { playerId });
      setGameState((prevState) => {
        if (!prevState) return prevState;
        return {
          ...prevState,
          players: prevState.players.map((p) =>
            p.id === playerId ? { ...p, disconnected: true } : p
          ),
        };
      });
    },

    playerReconnected({ playerId }) {
      debugLog('event', 'playerReconnected', { playerId });
      setGameState((prevState) => {
        if (!prevState) return prevState;
        return {
          ...prevState,
          players: prevState.players.map((p) =>
            p.id === playerId ? { ...p, disconnected: false } : p
          ),
        };
      });
    },

    gameAborted() {
      debugLog('event', 'gameAborted', {
        roomId: roomIdRef.current,
      });
      const savedSession = localStorage.getItem('skipBoSession');
      if (savedSession) {
        try {
          const { roomId } = JSON.parse(savedSession);
          sessionStorage.removeItem(`skipBoChat_${roomId}`);
        } catch {
          // ignore parse errors
        }
      }
      clearSession('gameAborted');
      roomIdRef.current = null;
      setGameState(null);
      setPlayerState(null);
      setRoomId(null);
      setInLobby(true);
      setChatMessages([]);
    },

    playerLeftPostGame({ gameState }) {
      setGameState(gameState);
    },

    chatMessage(messageData) {
      setChatMessages((prevMessages) => [...prevMessages, messageData]);
    },

    error({ message }) {
      debugLog('event', 'error', { message });
      setError(message);
      setTimeout(() => setError(null), 3000);
    },
  };
}
