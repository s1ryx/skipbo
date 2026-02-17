import React, { useState } from 'react';
import './WaitingRoom.css';
import { useTranslation } from '../i18n';

function WaitingRoom({ gameState, playerId, roomId, onStartGame, onLeaveLobby }) {
  const { t } = useTranslation();
  const [copySuccess, setCopySuccess] = useState(false);

  if (!gameState) {
    return <div className="loading">{t('game.loadingGame')}</div>;
  }

  const shareableLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  const copyLinkToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareableLink);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err); // eslint-disable-line no-console
    }
  };

  return (
    <div className="waiting-room">
      <h2>{t('game.room', { roomId })}</h2>
      <p>{t('game.shareLink')}</p>

      <div className="shareable-link-container">
        <input
          type="text"
          value={shareableLink}
          readOnly
          className="shareable-link-input"
          onClick={(e) => e.target.select()}
        />
        <button onClick={copyLinkToClipboard} className="btn-copy">
          {copySuccess ? t('game.copied') : t('game.copyLink')}
        </button>
      </div>

      <p className="or-text">
        {t('game.orShareCode')} <strong>{roomId}</strong>
      </p>

      <div className="players-waiting">
        <h3>
          {t('game.playersCount', {
            current: gameState.players.length,
            max: gameState.players.length,
          })}
        </h3>
        <ul>
          {gameState.players.map((player) => (
            <li key={player.id}>
              {player.name} {player.id === playerId ? t('game.you') : ''}
            </li>
          ))}
        </ul>
      </div>

      {gameState.players.length < 2 && <p>{t('game.waitingForPlayers')}</p>}

      <div className="lobby-actions">
        <button onClick={onLeaveLobby} className="btn-leave-lobby">
          {t('game.leaveGame')}
        </button>
        {gameState.players.length >= 2 && (
          <button onClick={onStartGame} className="btn-start-game">
            {t('game.startGame')}
          </button>
        )}
      </div>
    </div>
  );
}

export default WaitingRoom;
