import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../i18n';

// Minimum players Skip-Bo needs to start a game (mirrors server MIN_PLAYERS).
const MIN_PLAYERS = 2;

function GameOverOverlay({
  gameState,
  playerId,
  rematchVotes,
  rematchStockpileSize,
  onRequestRematch,
  onRequestRematchWithoutDisconnected,
  onUpdateRematchSettings,
  onLeaveGame,
}) {
  const { t } = useTranslation();
  const [localStockpileSize, setLocalStockpileSize] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    setLocalStockpileSize(null);
  }, [rematchStockpileSize]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const displaySize = localStockpileSize ?? rematchStockpileSize ?? gameState.stockpileSize;

  // Offer "rematch without disconnected" only when evicting the disconnected
  // players still leaves enough players to start a game.
  const hasDisconnectedPlayers = gameState.players.some((p) => p.disconnected);
  const remainingIfEvicted = gameState.players.filter((p) => !p.disconnected).length;
  const canRematchWithoutDisconnected = hasDisconnectedPlayers && remainingIfEvicted >= MIN_PLAYERS;

  const handleSliderChange = (e) => {
    const value = parseInt(e.target.value);
    setLocalStockpileSize(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onUpdateRematchSettings(value), 300);
  };

  const handleRematch = () => {
    if (debounceRef.current && localStockpileSize !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      onUpdateRematchSettings(localStockpileSize);
    }
    onRequestRematch();
  };

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

        <div className="rematch-section">
          <div className="rematch-settings">
            {gameState.hostPlayerId === playerId ? (
              <label className="rematch-stockpile-label">
                {t('game.rematchStockpile', { count: displaySize })}
                <input
                  type="range"
                  min="5"
                  max={gameState.players.length <= 4 ? 30 : 20}
                  step="5"
                  value={displaySize}
                  onChange={handleSliderChange}
                  className="stockpile-slider"
                />
              </label>
            ) : (
              <span className="rematch-stockpile-display">
                {t('game.rematchStockpile', { count: displaySize })}
              </span>
            )}
          </div>

          <div className="rematch-votes">
            {gameState.players.map((player) => (
              <div
                key={player.id}
                className={`rematch-vote-player ${player.disconnected ? 'disconnected' : ''}`}
              >
                <span
                  className={`vote-indicator ${rematchVotes.includes(player.id) ? 'voted' : ''}`}
                >
                  {rematchVotes.includes(player.id) ? '\u2713' : '\u25CB'}
                </span>
                <span className="vote-player-name">
                  {player.name}
                  {player.id === playerId ? ` ${t('game.you')}` : ''}
                  {player.disconnected ? ` ${t('game.disconnectedTag')}` : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="rematch-buttons">
            <button
              onClick={handleRematch}
              className={`btn-rematch ${rematchVotes.includes(playerId) ? 'voted' : ''}`}
              disabled={rematchVotes.includes(playerId)}
            >
              {rematchVotes.includes(playerId) ? t('game.rematchVoted') : t('game.rematch')}
            </button>
            {canRematchWithoutDisconnected && (
              <button
                onClick={onRequestRematchWithoutDisconnected}
                className="btn-rematch btn-rematch-without"
              >
                {t('game.rematchWithoutDisconnected')}
              </button>
            )}
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
