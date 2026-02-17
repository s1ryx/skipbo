/* eslint-disable no-console */
import { useState, useEffect } from 'react';
import io from 'socket.io-client';

const SOCKET_SERVER_URL = process.env.REACT_APP_SERVER_URL || undefined;

function clearSession(roomId) {
  if (roomId) {
    localStorage.removeItem(`skipBoChat_${roomId}`);
  }
  localStorage.removeItem('skipBoSession');
}

function saveSession(roomId, playerId, playerName) {
  localStorage.setItem('skipBoSession', JSON.stringify({ roomId, playerId, playerName }));
}

export default function useGameSocket(stablePlayerId) {
  const [socket, setSocket] = useState(null);
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
        console.error('Failed to load chat messages:', err);
      }
    }
    return [];
  });

  // Save chat messages to localStorage whenever they change
  useEffect(() => {
    if (roomId && chatMessages.length > 0) {
      localStorage.setItem(`skipBoChat_${roomId}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, roomId]);

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setPlayerId(newSocket.id);

      const savedSession = localStorage.getItem('skipBoSession');
      if (savedSession) {
        try {
          const { roomId, playerId, playerName } = JSON.parse(savedSession);
          console.log('Attempting to reconnect to room:', roomId);
          newSocket.emit('reconnect', { roomId, oldPlayerId: playerId, playerName });
        } catch (err) {
          console.error('Failed to parse saved session:', err);
          localStorage.removeItem('skipBoSession');
        }
      }
    });

    newSocket.on('roomCreated', ({ roomId, playerId, gameState }) => {
      console.log('Room created:', roomId);
      setRoomId(roomId);
      setPlayerId(playerId);
      setGameState(gameState);
      setInLobby(false);

      const player = gameState.players.find((p) => p.id === playerId);
      if (player) {
        saveSession(roomId, playerId, player.name);
      }
    });

    newSocket.on('playerJoined', ({ gameState }) => {
      console.log('Player joined');
      setGameState(gameState);

      const currentPlayer = gameState.players.find((p) => p.id === newSocket.id);
      if (currentPlayer) {
        saveSession(gameState.roomId, newSocket.id, currentPlayer.name);
      }
    });

    newSocket.on('playerLeft', ({ gameState }) => {
      console.log('Player left lobby');
      setGameState(gameState);
    });

    newSocket.on('reconnected', ({ roomId, playerId, gameState, playerState }) => {
      console.log('Successfully reconnected to room:', roomId);
      setRoomId(roomId);
      setPlayerId(playerId);
      setGameState(gameState);
      setPlayerState(playerState);
      setInLobby(false);

      const player = gameState.players.find((p) => p.id === playerId);
      if (player) {
        saveSession(roomId, playerId, player.name);
      }
    });

    newSocket.on('reconnectFailed', ({ message }) => {
      console.log('Reconnection failed:', message);
      localStorage.removeItem('skipBoSession');
      setError(message);
      setTimeout(() => setError(null), 5000);
    });

    newSocket.on('gameStarted', ({ gameState, playerState }) => {
      console.log('Game started');
      setGameState(gameState);
      setPlayerState(playerState);
    });

    newSocket.on('gameStateUpdate', ({ gameState, playerState }) => {
      setGameState(gameState);
      setPlayerState(playerState);
    });

    newSocket.on('turnChanged', ({ currentPlayerId }) => {
      console.log('Turn changed to:', currentPlayerId);
    });

    newSocket.on('gameOver', ({ gameState }) => {
      setGameState(gameState);
      const savedSession = localStorage.getItem('skipBoSession');
      if (savedSession) {
        try {
          const { roomId } = JSON.parse(savedSession);
          clearSession(roomId);
        } catch (err) {
          console.error('Failed to clear chat messages:', err);
          localStorage.removeItem('skipBoSession');
        }
      } else {
        localStorage.removeItem('skipBoSession');
      }
    });

    newSocket.on('playerDisconnected', ({ playerId }) => {
      setGameState((prevState) => {
        if (!prevState) return prevState;
        return {
          ...prevState,
          players: prevState.players.map((p) =>
            p.id === playerId ? { ...p, disconnected: true } : p
          ),
        };
      });
    });

    newSocket.on('gameAborted', () => {
      console.log('Game aborted by a player');
      const savedSession = localStorage.getItem('skipBoSession');
      if (savedSession) {
        try {
          const { roomId } = JSON.parse(savedSession);
          clearSession(roomId);
        } catch (err) {
          console.error('Failed to clear chat messages:', err);
          localStorage.removeItem('skipBoSession');
        }
      } else {
        localStorage.removeItem('skipBoSession');
      }
      setGameState(null);
      setPlayerState(null);
      setRoomId(null);
      setInLobby(true);
      setChatMessages([]);
    });

    newSocket.on('chatMessage', (messageData) => {
      setChatMessages((prevMessages) => [...prevMessages, messageData]);
    });

    newSocket.on('error', ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Action functions
  const createRoom = (playerName, maxPlayers, stockpileSize) => {
    if (socket) {
      socket.emit('createRoom', { playerName, maxPlayers, stockpileSize });
    }
  };

  const joinRoom = (joinRoomId, playerName) => {
    if (socket) {
      socket.emit('joinRoom', { roomId: joinRoomId, playerName });
      setRoomId(joinRoomId);
      setInLobby(false);
    }
  };

  const startGame = () => {
    if (socket) {
      socket.emit('startGame');
    }
  };

  const playCard = (card, source, buildingPileIndex) => {
    if (socket) {
      socket.emit('playCard', { card, source, buildingPileIndex });
    }
  };

  const discardCard = (card, discardPileIndex) => {
    if (socket) {
      socket.emit('discardCard', { card, discardPileIndex });
    }
  };

  const endTurn = () => {
    if (socket) {
      socket.emit('endTurn');
    }
  };

  const leaveLobby = () => {
    if (socket) {
      socket.emit('leaveLobby');
      localStorage.removeItem('skipBoSession');
      setGameState(null);
      setPlayerState(null);
      setRoomId(null);
      setInLobby(true);
    }
  };

  const leaveGame = () => {
    if (socket) {
      if (roomId) {
        localStorage.removeItem(`skipBoChat_${roomId}`);
      }
      socket.emit('leaveGame');
    }
  };

  const sendChatMessage = (message) => {
    if (socket) {
      socket.emit('sendChatMessage', { message, stablePlayerId });
    }
  };

  const markMessagesAsRead = () => {
    setChatMessages((prevMessages) => prevMessages.map((msg) => ({ ...msg, read: true })));
  };

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
    endTurn,
    leaveLobby,
    leaveGame,
    sendChatMessage,
    markMessagesAsRead,
  };
}
