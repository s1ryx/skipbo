import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

// Mirrors POST_GAME_MIN_SAVOR_MS on the server: how long the results screen
// stays up before "Back to room" unlocks, so one eager player cannot cut the
// celebration short for the room.
const MIN_SAVOR_MS = 10000;

function GameOverOverlay({ gameState, onReturnToLobby, onLeaveGame }) {
  const { t } = useTranslation();
  const finishedAt = gameState.finishedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!finishedAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [finishedAt]);

  const remainingMs = finishedAt ? Math.max(0, MIN_SAVOR_MS - (now - finishedAt)) : 0;
  const canReturn = remainingMs === 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      className="game-over-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
    >
      <div className="game-over-message">
        <h2 id="game-over-title">{t('game.gameOver')}</h2>
        <p className="winner-text">{t('game.winner', { name: gameState.winner?.name })}</p>

        <div className="game-over-actions">
          <div className="game-over-buttons">
            <button onClick={onReturnToLobby} className="btn-back-to-room" disabled={!canReturn}>
              {canReturn
                ? t('game.backToRoom')
                : t('game.backToRoomIn', { seconds: remainingSeconds })}
            </button>
            <button onClick={onLeaveGame} className="btn-leave">
              {t('game.leave')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameOverOverlay;
