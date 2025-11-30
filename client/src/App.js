import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import './App.css';
import GameBoard from './components/GameBoard';
import Lobby from './components/Lobby';

const SOCKET_SERVER_URL = 'http://localhost:3001';

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
    });

    newSocket.on('roomCreated', ({ roomId, playerId, gameState }) => {
      console.log('Room created:', roomId);
      setRoomId(roomId);
      setPlayerId(playerId);
      setGameState(gameState);
      setInLobby(false);
    });

    newSocket.on('playerJoined', ({ gameState }) => {
      console.log('Player joined');
      setGameState(gameState);
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

  const createRoom = (playerName, maxPlayers) => {
    if (socket) {
      socket.emit('createRoom', { playerName, maxPlayers });
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
    </div>
  );
}

export default App;
