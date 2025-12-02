import React, { useState } from 'react';
import './Lobby.css';

function Lobby({ onCreateRoom, onJoinRoom }) {
  const [playerName, setPlayerName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [stockpileSize, setStockpileSize] = useState(30);
  const [roomIdToJoin, setRoomIdToJoin] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);

  // Get max allowed stockpile size based on player count
  const getMaxStockpileSize = (players) => {
    return players <= 4 ? 30 : 20;
  };

  const handleMaxPlayersChange = (newMaxPlayers) => {
    setMaxPlayers(newMaxPlayers);
    const maxAllowed = getMaxStockpileSize(newMaxPlayers);
    if (stockpileSize > maxAllowed) {
      setStockpileSize(maxAllowed);
    }
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (playerName.trim()) {
      onCreateRoom(playerName, maxPlayers, stockpileSize);
    }
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (playerName.trim() && roomIdToJoin.trim()) {
      onJoinRoom(roomIdToJoin.toUpperCase(), playerName);
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-container">
        <h2>Welcome to Skip-Bo!</h2>

        <div className="lobby-options">
          {!showJoinForm ? (
            <div className="create-room-form">
              <h3>Create a New Game</h3>
              <form onSubmit={handleCreateRoom}>
                <div className="form-group">
                  <label>Your Name:</label>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter your name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Max Players:</label>
                  <select
                    value={maxPlayers}
                    onChange={(e) => handleMaxPlayersChange(parseInt(e.target.value))}
                  >
                    <option value={2}>2 Players</option>
                    <option value={3}>3 Players</option>
                    <option value={4}>4 Players</option>
                    <option value={5}>5 Players</option>
                    <option value={6}>6 Players</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    Stockpile Size: {stockpileSize} cards
                    <span className="label-hint">
                      (Max {getMaxStockpileSize(maxPlayers)} for {maxPlayers} players)
                    </span>
                  </label>
                  <input
                    type="range"
                    min="5"
                    max={getMaxStockpileSize(maxPlayers)}
                    step="5"
                    value={stockpileSize}
                    onChange={(e) => setStockpileSize(parseInt(e.target.value))}
                    className="stockpile-slider"
                  />
                </div>

                <button type="submit" className="btn-primary">
                  Create Room
                </button>
              </form>

              <div className="divider">OR</div>

              <button
                onClick={() => setShowJoinForm(true)}
                className="btn-secondary"
              >
                Join Existing Room
              </button>
            </div>
          ) : (
            <div className="join-room-form">
              <h3>Join a Game</h3>
              <form onSubmit={handleJoinRoom}>
                <div className="form-group">
                  <label>Your Name:</label>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter your name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Room ID:</label>
                  <input
                    type="text"
                    value={roomIdToJoin}
                    onChange={(e) => setRoomIdToJoin(e.target.value.toUpperCase())}
                    placeholder="Enter room ID"
                    required
                    maxLength={6}
                  />
                </div>

                <button type="submit" className="btn-primary">
                  Join Room
                </button>
              </form>

              <button
                onClick={() => setShowJoinForm(false)}
                className="btn-secondary"
              >
                Back to Create Room
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Lobby;
