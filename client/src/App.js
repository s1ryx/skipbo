import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import './App.css';
import GameBoard from './components/GameBoard';
import Lobby from './components/Lobby';

// When REACT_APP_SERVER_URL is not set or empty, use undefined to connect to same origin
// This allows Socket.IO to connect to the domain where the app is hosted
const SOCKET_SERVER_URL = process.env.REACT_APP_SERVER_URL || undefined;
const VERSION = process.env.REACT_APP_VERSION || require('../package.json').version;

function App() {
  const [socket, setSocket] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [inLobby, setInLobby] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setPlayerId(newSocket.id);

      // Check for existing session and attempt reconnection
      const savedSession = localStorage.getItem('skipBoSession');
      if (savedSession) {
        try {
          const { roomId, playerId, playerName } = JSON.parse(savedSession);
          console.log('Attempting to reconnect to room:', roomId);
          newSocket.emit('reconnect', { roomId, oldPlayerId: playerId, playerName });
        } catch (error) {
          console.error('Failed to parse saved session:', error);
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

      // Save session data
      const player = gameState.players.find(p => p.id === playerId);
      if (player) {
        localStorage.setItem('skipBoSession', JSON.stringify({
          roomId,
          playerId,
          playerName: player.name
        }));
      }
    });

    newSocket.on('playerJoined', ({ gameState }) => {
      console.log('Player joined');
      setGameState(gameState);

      // Save session data when joining
      const currentPlayer = gameState.players.find(p => p.id === newSocket.id);
      if (currentPlayer) {
        localStorage.setItem('skipBoSession', JSON.stringify({
          roomId: gameState.roomId,
          playerId: newSocket.id,
          playerName: currentPlayer.name
        }));
      }
    });

    newSocket.on('reconnected', ({ roomId, playerId, gameState, playerState }) => {
      console.log('Successfully reconnected to room:', roomId);
      setRoomId(roomId);
      setPlayerId(playerId);
      setGameState(gameState);
      setPlayerState(playerState);
      setInLobby(false);

      // Update session with new socket ID
      const player = gameState.players.find(p => p.id === playerId);
      if (player) {
        localStorage.setItem('skipBoSession', JSON.stringify({
          roomId,
          playerId,
          playerName: player.name
        }));
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

    newSocket.on('gameOver', ({ winner, gameState }) => {
      setGameState(gameState);
      localStorage.removeItem('skipBoSession'); // Clear session when game ends
      alert(`Game Over! Winner: ${winner.name}`);
    });

    newSocket.on('playerDisconnected', ({ message }) => {
      alert(message);
    });

    newSocket.on('error', ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const createRoom = (playerName, maxPlayers, stockpileSize) => {
    if (socket) {
      socket.emit('createRoom', { playerName, maxPlayers, stockpileSize });
    }
  };

  const joinRoom = (roomId, playerName) => {
    if (socket) {
      socket.emit('joinRoom', { roomId, playerName });
      setRoomId(roomId);
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

  return (
    <div className="App">
      <header className="App-header">
        <h1>Skip-Bo Card Game</h1>
      </header>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {inLobby ? (
        <Lobby
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
        />
      ) : (
        <GameBoard
          gameState={gameState}
          playerState={playerState}
          playerId={playerId}
          roomId={roomId}
          onStartGame={startGame}
          onPlayCard={playCard}
          onDiscardCard={discardCard}
          onEndTurn={endTurn}
        />
      )}

      <footer className="App-footer">
        <span className="version">v{VERSION}</span>
      </footer>
    </div>
  );
}

export default App;
