import React from 'react';
import Card from './Card';
import './PlayerHand.css';
import { useTranslation } from '../i18n';

function PlayerHand({
  hand,
  selectedCard,
  selectedSource,
  onCardSelect,
  disabled,
  sortHandEnabled,
}) {
  const { t } = useTranslation();
  const displayHand = sortHandEnabled
    ? [...hand].sort((a, b) => {
        if (a === 'SKIP-BO') return 1;
        if (b === 'SKIP-BO') return -1;
        return a - b;
      })
    : hand;
  return (
    <div className="player-hand">
      <div className="hand-label">{t('hand.title')}</div>
      <div className="hand-cards">
        {displayHand && displayHand.length > 0 ? (
          displayHand.map((card, index) => (
            <div
              key={index}
              className={`hand-card ${selectedCard === card && selectedSource === `hand-${index}` ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
              onClick={() => !disabled && onCardSelect(card, `hand-${index}`)}
            >
              <Card value={card} isVisible={true} />
            </div>
          ))
        ) : (
          <div className="empty-hand">{t('hand.empty')}</div>
        )}
      </div>
    </div>
  );
}

export default PlayerHand;
