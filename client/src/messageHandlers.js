export function createMessageHandlers({
  setGameState,
  setPlayerState,
  setPlayerId,
  setRoomId,
  setInLobby,
  setError,
  setRematchVotes,
  setRematchStockpileSize,
  setChatMessages,
  setLoginState,
  roomIdRef,
  sessionTokenRef,
  transportRef,
}) {
  function saveSession(roomId, playerId, playerName, sessionToken) {
    localStorage.setItem(
      'skipBoSession',
      JSON.stringify({ roomId, playerId, playerName, sessionToken })
    );
  }

  return {
    roomCreated({ roomId, playerId, sessionToken, gameState }) {
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
      setGameState(gameState);
    },

    sessionToken({ playerId, sessionToken }) {
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
      setGameState(gameState);
    },

    reconnected({ roomId, playerId, sessionToken, gameState, playerState }) {
      roomIdRef.current = roomId;
      sessionTokenRef.current = sessionToken;
      setRoomId(roomId);
      setPlayerId(playerId);
      setGameState(gameState);
      setPlayerState(playerState);
      setInLobby(false);

      if (gameState.gameOver) {
        setRematchVotes(gameState.rematchVotes || []);
      }

      const player = gameState.players.find((p) => p.id === playerId);
      if (player) {
        saveSession(roomId, playerId, player.name, sessionToken);
      }
    },

    reconnectFailed({ message }) {
      localStorage.removeItem('skipBoSession');
      setError(message);
      setTimeout(() => setError(null), 5000);
    },

    gameStarted({ gameState, playerState }) {
      setGameState(gameState);
      setPlayerState(playerState);
      setRematchVotes([]);
      setRematchStockpileSize(null);
    },

    gameStateUpdate({ gameState, playerState }) {
      setGameState(gameState);
      setPlayerState(playerState);
    },

    gameOver({ gameState }) {
      setGameState(gameState);
      const savedSession = localStorage.getItem('skipBoSession');
      if (savedSession) {
        try {
          const { roomId } = JSON.parse(savedSession);
          sessionStorage.removeItem(`skipBoChat_${roomId}`);
        } catch {
          // ignore parse errors
        }
      }
      localStorage.removeItem('skipBoSession');
    },

    playerDisconnected({ playerId }) {
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
      const savedSession = localStorage.getItem('skipBoSession');
      if (savedSession) {
        try {
          const { roomId } = JSON.parse(savedSession);
          sessionStorage.removeItem(`skipBoChat_${roomId}`);
        } catch {
          // ignore parse errors
        }
      }
      localStorage.removeItem('skipBoSession');
      roomIdRef.current = null;
      setGameState(null);
      setPlayerState(null);
      setRoomId(null);
      setInLobby(true);
      setChatMessages([]);
      setRematchVotes([]);
      setRematchStockpileSize(null);
    },

    rematchVoteUpdate({ rematchVotes, stockpileSize }) {
      setRematchVotes(rematchVotes);
      setRematchStockpileSize(stockpileSize);
    },

    playerLeftPostGame({ gameState }) {
      setGameState(gameState);
      setRematchVotes([]);
      setRematchStockpileSize(null);
    },

    chatMessage(messageData) {
      setChatMessages((prevMessages) => [...prevMessages, messageData]);
    },

    loggedIn({ username, hasPassword, sessionData }) {
      setLoginState({
        isLoggedIn: true,
        username,
        hasPassword,
        error: null,
      });

      if (sessionData) {
        localStorage.setItem('skipBoSession', JSON.stringify(sessionData));
        transportRef.current?.send('reconnect', {
          roomId: sessionData.roomId,
          sessionToken: sessionData.sessionToken,
          playerName: sessionData.playerName,
        });
      }
    },

    loginFailed({ error }) {
      setLoginState((prev) => ({ ...prev, error }));
      setTimeout(
        () => setLoginState((prev) => ({ ...prev, error: null })),
        5000
      );
    },

    error({ message }) {
      setError(message);
      setTimeout(() => setError(null), 3000);
    },
  };
}
