import { useState, useEffect, useCallback, useRef } from 'react';
import SocketIOClientTransport from './transport/SocketIOClientTransport';

export default function useGameConnection() {
  const [gameState, setGameState] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [inLobby, setInLobby] = useState(true);
  const [error, setError] = useState(null);
  const [rematchVotes, setRematchVotes] = useState([]);
  const [rematchStockpileSize, setRematchStockpileSize] = useState(null);
  const [chatMessages, setChatMessages] = useState(() => {
    const savedSession = sessionStorage.getItem('skipBoSession');
    if (savedSession) {
      try {
        const { roomId } = JSON.parse(savedSession);
        const savedMessages = sessionStorage.getItem(`skipBoChat_${roomId}`);
        if (savedMessages) {
          return JSON.parse(savedMessages);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to load chat messages:', err);
      }
    }
    return [];
  });
  const transportRef = useRef(null);
  const connectionIdRef = useRef(null);
  const roomIdRef = useRef(null);
  const sessionTokenRef = useRef(null);

  // Save chat messages to sessionStorage whenever they change
  useEffect(() => {
    if (roomId && chatMessages.length > 0) {
      sessionStorage.setItem(`skipBoChat_${roomId}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, roomId]);

  useEffect(() => {
    const messageHandlers = {
      roomCreated: ({ roomId, playerId, sessionToken, gameState }) => {
        // eslint-disable-next-line no-console
        console.log('Room created:', roomId);
        roomIdRef.current = roomId;
        sessionTokenRef.current = sessionToken;
        setRoomId(roomId);
        setPlayerId(playerId);
        setGameState(gameState);
        setInLobby(false);

        const player = gameState.players.find((p) => p.id === playerId);
        if (player) {
          sessionStorage.setItem(
            'skipBoSession',
            JSON.stringify({ roomId, playerId, playerName: player.name, sessionToken })
          );
        }
      },

      playerJoined: ({ gameState }) => {
        // eslint-disable-next-line no-console
        console.log('Player joined');
        setGameState(gameState);
      },

      sessionToken: ({ playerId, sessionToken }) => {
        sessionTokenRef.current = sessionToken;
        setPlayerId(playerId);
        setGameState((prev) => {
          if (!prev) return prev;
          roomIdRef.current = prev.roomId;
          setRoomId(prev.roomId);
          setInLobby(false);
          const player = prev.players.find((p) => p.id === playerId);
          if (player) {
            sessionStorage.setItem(
              'skipBoSession',
              JSON.stringify({
                roomId: prev.roomId,
                playerId,
                playerName: player.name,
                sessionToken,
              })
            );
          }
          return prev;
        });
      },

      playerLeft: ({ gameState }) => {
        // eslint-disable-next-line no-console
        console.log('Player left lobby');
        setGameState(gameState);
      },

      reconnected: ({ roomId, playerId, sessionToken, gameState, playerState }) => {
        // eslint-disable-next-line no-console
        console.log('Successfully reconnected to room:', roomId);
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
          sessionStorage.setItem(
            'skipBoSession',
            JSON.stringify({ roomId, playerId, playerName: player.name, sessionToken })
          );
        }
      },

      reconnectFailed: ({ message }) => {
        // eslint-disable-next-line no-console
        console.log('Reconnection failed:', message);
        sessionStorage.removeItem('skipBoSession');
        setError(message);
        setTimeout(() => setError(null), 5000);
      },

      gameStarted: ({ gameState, playerState }) => {
        // eslint-disable-next-line no-console
        console.log('Game started');
        setGameState(gameState);
        setPlayerState(playerState);
        setRematchVotes([]);
        setRematchStockpileSize(null);
      },

      gameStateUpdate: ({ gameState, playerState }) => {
        setGameState(gameState);
        setPlayerState(playerState);
      },

      gameOver: ({ gameState }) => {
        setGameState(gameState);
        const savedSession = sessionStorage.getItem('skipBoSession');
        if (savedSession) {
          try {
            const { roomId } = JSON.parse(savedSession);
            sessionStorage.removeItem(`skipBoChat_${roomId}`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to clear chat messages:', err);
          }
        }
        sessionStorage.removeItem('skipBoSession');
      },

      playerDisconnected: ({ playerId }) => {
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

      playerReconnected: ({ playerId }) => {
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

      gameAborted: () => {
        // eslint-disable-next-line no-console
        console.log('Game aborted by a player');
        const savedSession = sessionStorage.getItem('skipBoSession');
        if (savedSession) {
          try {
            const { roomId } = JSON.parse(savedSession);
            sessionStorage.removeItem(`skipBoChat_${roomId}`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to clear chat messages:', err);
          }
        }
        sessionStorage.removeItem('skipBoSession');
        roomIdRef.current = null;
        setGameState(null);
        setPlayerState(null);
        setRoomId(null);
        setInLobby(true);
        setChatMessages([]);
        setRematchVotes([]);
        setRematchStockpileSize(null);
      },

      rematchVoteUpdate: ({ rematchVotes, stockpileSize }) => {
        setRematchVotes(rematchVotes);
        setRematchStockpileSize(stockpileSize);
      },

      playerLeftPostGame: ({ gameState }) => {
        setGameState(gameState);
        setRematchVotes([]);
        setRematchStockpileSize(null);
      },

      chatMessage: (messageData) => {
        setChatMessages((prevMessages) => [...prevMessages, messageData]);
      },

      error: ({ message }) => {
        setError(message);
        setTimeout(() => setError(null), 3000);
      },
    };

    const transport = new SocketIOClientTransport({
      onConnect: (connectionId) => {
        // eslint-disable-next-line no-console
        console.log('Connected to server');
        connectionIdRef.current = connectionId;
        setPlayerId(connectionId);

        const savedSession = sessionStorage.getItem('skipBoSession');
        if (savedSession) {
          try {
            const { roomId, playerName, sessionToken } = JSON.parse(savedSession);
            // eslint-disable-next-line no-console
            console.log('Attempting to reconnect to room:', roomId);
            transport.send('reconnect', { roomId, sessionToken, playerName });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to parse saved session:', err);
            sessionStorage.removeItem('skipBoSession');
          }
        }
      },
      onDisconnect: () => {},
      onMessage: (event, data) => {
        const handler = messageHandlers[event];
        if (handler) handler(data);
      },
    });

    transport.connect();
    transportRef.current = transport;

    return () => transport.disconnect();
  }, []);

  const createRoom = useCallback((playerName, maxPlayers, stockpileSize) => {
    transportRef.current?.send('createRoom', { playerName, maxPlayers, stockpileSize });
  }, []);

  const joinRoom = useCallback((joinRoomId, playerName) => {
    transportRef.current?.send('joinRoom', { roomId: joinRoomId, playerName });
  }, []);

  const startGame = useCallback(() => {
    transportRef.current?.send('startGame');
  }, []);

  const playCard = useCallback((card, source, buildingPileIndex) => {
    transportRef.current?.send('playCard', { card, source, buildingPileIndex });
  }, []);

  const discardCard = useCallback((card, discardPileIndex) => {
    transportRef.current?.send('discardCard', { card, discardPileIndex });
  }, []);

  const leaveLobby = useCallback(() => {
    transportRef.current?.send('leaveLobby');
    sessionStorage.removeItem('skipBoSession');
    roomIdRef.current = null;
    setGameState(null);
    setPlayerState(null);
    setRoomId(null);
    setInLobby(true);
  }, []);

  const leaveGame = useCallback(() => {
    if (roomIdRef.current) {
      sessionStorage.removeItem(`skipBoChat_${roomIdRef.current}`);
    }
    transportRef.current?.send('leaveGame');
  }, []);

  const requestRematch = useCallback(() => {
    transportRef.current?.send('requestRematch');
  }, []);

  const updateRematchSettings = useCallback((stockpileSize) => {
    transportRef.current?.send('updateRematchSettings', { stockpileSize });
  }, []);

  const sendChatMessage = useCallback((message) => {
    transportRef.current?.send('sendChatMessage', { message });
  }, []);

  const markMessagesAsRead = useCallback(() => {
    setChatMessages((prevMessages) => prevMessages.map((msg) => ({ ...msg, read: true })));
  }, []);

  const addBot = useCallback((aiType) => {
    transportRef.current?.send('addBot', { aiType });
  }, []);

  const removeBot = useCallback((botPlayerId) => {
    transportRef.current?.send('removeBot', { botPlayerId });
  }, []);

  return {
    gameState,
    playerState,
    playerId,
    roomId,
    inLobby,
    error,
    chatMessages,
    createRoom,
    joinRoom,
    startGame,
    playCard,
    discardCard,
    leaveLobby,
    leaveGame,
    requestRematch,
    updateRematchSettings,
    rematchVotes,
    rematchStockpileSize,
    sendChatMessage,
    markMessagesAsRead,
    addBot,
    removeBot,
  };
}
