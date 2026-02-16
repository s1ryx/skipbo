import React from 'react';
import Card from './Card';
import './PlayerHand.css';
import { useTranslation } from '../i18n';

function PlayerHand({ hand, selectedCard, selectedSource, onCardSelect, disabled }) {
  const { t } = useTranslation();
  return (
    <div className="player-hand">
      <div className="hand-label">{t('hand.title')}</div>
      <div className="hand-cards">
        {hand && hand.length > 0 ? (
          hand.map((card, index) => (
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
