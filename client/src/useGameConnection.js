import { useState, useEffect, useCallback, useRef } from 'react';
import SocketIOClientTransport from './transport/SocketIOClientTransport';

// Generate a stable unique player identifier
const generatePlayerUniqueId = () => {
  return 'player_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
};

// Get or create stable player ID
const getStablePlayerId = () => {
  let stableId = localStorage.getItem('skipBoStablePlayerId');
  if (!stableId) {
    stableId = generatePlayerUniqueId();
    localStorage.setItem('skipBoStablePlayerId', stableId);
  }
  return stableId;
};

export default function useGameConnection() {
  const [gameState, setGameState] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [inLobby, setInLobby] = useState(true);
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState(() => {
    const savedSession = localStorage.getItem('skipBoSession');
    if (savedSession) {
      try {
        const { roomId } = JSON.parse(savedSession);
        const savedMessages = localStorage.getItem(`skipBoChat_${roomId}`);
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
  const [stablePlayerId] = useState(getStablePlayerId);
  const transportRef = useRef(null);
  const connectionIdRef = useRef(null);
  const roomIdRef = useRef(null);

  // Save chat messages to localStorage whenever they change
  useEffect(() => {
    if (roomId && chatMessages.length > 0) {
      localStorage.setItem(`skipBoChat_${roomId}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, roomId]);

  useEffect(() => {
    const messageHandlers = {
      roomCreated: ({ roomId, playerId, gameState }) => {
        // eslint-disable-next-line no-console
        console.log('Room created:', roomId);
        roomIdRef.current = roomId;
        setRoomId(roomId);
        setPlayerId(playerId);
        setGameState(gameState);
        setInLobby(false);

        const player = gameState.players.find((p) => p.id === playerId);
        if (player) {
          localStorage.setItem(
            'skipBoSession',
            JSON.stringify({ roomId, playerId, playerName: player.name })
          );
        }
      },

      playerJoined: ({ playerId, gameState }) => {
        // eslint-disable-next-line no-console
        console.log('Player joined');
        setGameState(gameState);

        const myId = connectionIdRef.current;
        if (playerId === myId) {
          roomIdRef.current = gameState.roomId;
          setRoomId(gameState.roomId);
          setInLobby(false);
        }

        if (myId) {
          const currentPlayer = gameState.players.find((p) => p.id === myId);
          if (currentPlayer) {
            localStorage.setItem(
              'skipBoSession',
              JSON.stringify({
                roomId: gameState.roomId,
                playerId: myId,
                playerName: currentPlayer.name,
              })
            );
          }
        }
      },

      playerLeft: ({ gameState }) => {
        // eslint-disable-next-line no-console
        console.log('Player left lobby');
        setGameState(gameState);
      },

      reconnected: ({ roomId, playerId, gameState, playerState }) => {
        // eslint-disable-next-line no-console
        console.log('Successfully reconnected to room:', roomId);
        roomIdRef.current = roomId;
        setRoomId(roomId);
        setPlayerId(playerId);
        setGameState(gameState);
        setPlayerState(playerState);
        setInLobby(false);

        const player = gameState.players.find((p) => p.id === playerId);
        if (player) {
          localStorage.setItem(
            'skipBoSession',
            JSON.stringify({ roomId, playerId, playerName: player.name })
          );
        }
      },

      reconnectFailed: ({ message }) => {
        // eslint-disable-next-line no-console
        console.log('Reconnection failed:', message);
        localStorage.removeItem('skipBoSession');
        setError(message);
        setTimeout(() => setError(null), 5000);
      },

      gameStarted: ({ gameState, playerState }) => {
        // eslint-disable-next-line no-console
        console.log('Game started');
        setGameState(gameState);
        setPlayerState(playerState);
      },

      gameStateUpdate: ({ gameState, playerState }) => {
        setGameState(gameState);
        setPlayerState(playerState);
      },

      gameOver: ({ gameState }) => {
        setGameState(gameState);
        const savedSession = localStorage.getItem('skipBoSession');
        if (savedSession) {
          try {
            const { roomId } = JSON.parse(savedSession);
            localStorage.removeItem(`skipBoChat_${roomId}`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to clear chat messages:', err);
          }
        }
        localStorage.removeItem('skipBoSession');
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

      gameAborted: () => {
        // eslint-disable-next-line no-console
        console.log('Game aborted by a player');
        const savedSession = localStorage.getItem('skipBoSession');
        if (savedSession) {
          try {
            const { roomId } = JSON.parse(savedSession);
            localStorage.removeItem(`skipBoChat_${roomId}`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to clear chat messages:', err);
          }
        }
        localStorage.removeItem('skipBoSession');
        roomIdRef.current = null;
        setGameState(null);
        setPlayerState(null);
        setRoomId(null);
        setInLobby(true);
        setChatMessages([]);
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

        const savedSession = localStorage.getItem('skipBoSession');
        if (savedSession) {
          try {
            const { roomId, playerId, playerName } = JSON.parse(savedSession);
            // eslint-disable-next-line no-console
            console.log('Attempting to reconnect to room:', roomId);
            transport.send('reconnect', { roomId, oldPlayerId: playerId, playerName });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to parse saved session:', err);
            localStorage.removeItem('skipBoSession');
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
    localStorage.removeItem('skipBoSession');
    roomIdRef.current = null;
    setGameState(null);
    setPlayerState(null);
    setRoomId(null);
    setInLobby(true);
  }, []);

  const leaveGame = useCallback(() => {
    if (roomIdRef.current) {
      localStorage.removeItem(`skipBoChat_${roomIdRef.current}`);
    }
    transportRef.current?.send('leaveGame');
  }, []);

  const sendChatMessage = useCallback(
    (message) => {
      transportRef.current?.send('sendChatMessage', { message, stablePlayerId });
    },
    [stablePlayerId]
  );

  const markMessagesAsRead = useCallback(() => {
    setChatMessages((prevMessages) => prevMessages.map((msg) => ({ ...msg, read: true })));
  }, []);

  return {
    gameState,
    playerState,
    playerId,
    roomId,
    inLobby,
    error,
    chatMessages,
    stablePlayerId,
    createRoom,
    joinRoom,
    startGame,
    playCard,
    discardCard,
    leaveLobby,
    leaveGame,
    sendChatMessage,
    markMessagesAsRead,
  };
}
