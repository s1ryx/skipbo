import { useState, useEffect, useCallback, useRef } from 'react';
import SocketIOClientTransport from './transport/SocketIOClientTransport';
import { createMessageHandlers } from './messageHandlers';

export default function useGameConnection() {
  const [gameState, setGameState] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [inLobby, setInLobby] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
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
    const handlers = createMessageHandlers({
      setGameState,
      setPlayerState,
      setPlayerId,
      setRoomId,
      setInLobby,
      setError,
      setRematchVotes,
      setRematchStockpileSize,
      setChatMessages,
      roomIdRef,
      sessionTokenRef,
    });

    const transport = new SocketIOClientTransport({
      onConnect: (connectionId) => {
        connectionIdRef.current = connectionId;
        setPlayerId(connectionId);
        setIsConnected(true);

        const savedSession = sessionStorage.getItem('skipBoSession');
        if (savedSession) {
          try {
            const { roomId, playerName, sessionToken } = JSON.parse(savedSession);
            transport.send('reconnect', { roomId, sessionToken, playerName });
          } catch {
            sessionStorage.removeItem('skipBoSession');
          }
        }
      },
      onDisconnect: () => {
        setIsConnected(false);
      },
      onMessage: (event, data) => {
        const handler = handlers[event];
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
    isConnected,
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
