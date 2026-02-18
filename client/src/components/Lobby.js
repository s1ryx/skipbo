import React, { useState, useEffect } from 'react';
import './Lobby.css';
import { useTranslation } from '../i18n';

function Lobby({ onCreateRoom, onJoinRoom, initialRoomId }) {
  const { t } = useTranslation();
  const [playerName, setPlayerName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [stockpileSize, setStockpileSize] = useState(30);
  const [roomIdToJoin, setRoomIdToJoin] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);

  // If initialRoomId is provided from URL, pre-fill and show join form
  useEffect(() => {
    if (initialRoomId) {
      setRoomIdToJoin(initialRoomId);
      setShowJoinForm(true);
    }
  }, [initialRoomId]);

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
        <h2>{t('lobby.welcome')}</h2>

        <div className="lobby-options">
          {!showJoinForm ? (
            <div className="create-room-form">
              <h3>{t('lobby.createGame')}</h3>
              <form onSubmit={handleCreateRoom}>
                <div className="form-group">
                  <label>{t('lobby.yourName')}</label>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder={t('lobby.enterName')}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>{t('lobby.maxPlayers')}</label>
                  <select
                    value={maxPlayers}
                    onChange={(e) => handleMaxPlayersChange(parseInt(e.target.value))}
                  >
                    {[2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {t('lobby.players_option', { count: n })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    {t('lobby.stockpileSize', { count: stockpileSize })}
                    <span className="label-hint">
                      {t('lobby.stockpileHint', {
                        max: getMaxStockpileSize(maxPlayers),
                        count: maxPlayers,
                      })}
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
                  {t('lobby.createRoom')}
                </button>
              </form>

              <div className="divider">{t('lobby.or')}</div>

              <button onClick={() => setShowJoinForm(true)} className="btn-secondary">
                {t('lobby.joinExisting')}
              </button>
            </div>
          ) : (
            <div className="join-room-form">
              <h3>{t('lobby.joinGame')}</h3>
              <form onSubmit={handleJoinRoom}>
                <div className="form-group">
                  <label>{t('lobby.yourName')}</label>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder={t('lobby.enterName')}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>{t('lobby.roomId')}</label>
                  <input
                    type="text"
                    value={roomIdToJoin}
                    onChange={(e) => setRoomIdToJoin(e.target.value.toUpperCase())}
                    placeholder={t('lobby.enterRoomId')}
                    required
                    maxLength={6}
                  />
                </div>

                <button type="submit" className="btn-primary">
                  {t('lobby.joinRoom')}
                </button>
              </form>

              <button onClick={() => setShowJoinForm(false)} className="btn-secondary">
                {t('lobby.backToCreate')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Lobby;
