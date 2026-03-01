import React from 'react';
import Card from './Card';
import { useTranslation } from '../i18n';

function OpponentArea({ opponents, currentPlayerId }) {
  const { t } = useTranslation();

  return (
    <div className="other-players">
      {opponents.map((player) => (
        <div
          key={player.id}
          className={`opponent-info ${currentPlayerId !== player.id ? 'inactive' : ''}`}
        >
          <h4>
            {player.name}
            {player.isBot && <span className="bot-badge"> {t('game.bot')}</span>}
            {currentPlayerId === player.id && ' ' + t('game.playing')}
            {player.disconnected && !player.isBot && (
              <span className="disconnected-indicator"> {t('game.disconnected')}</span>
            )}
          </h4>
          <div className="opponent-cards">
            <div className="card-pile">
              <div className="pile-label">
                {t('game.stockpile', { count: player.stockpileCount })}
              </div>
              {player.stockpileTop && <Card value={player.stockpileTop} isVisible={true} />}
            </div>
            <div className="card-pile">
              <div className="pile-label">{t('game.hand', { count: player.handCount })}</div>
              <div className="opponent-hand-stack">
                {Array.from({ length: Math.min(player.handCount, 5) }).map((_, idx) => (
                  <div
                    key={idx}
                    className="card-in-hand"
                    style={{ marginLeft: idx > 0 ? '-30px' : '0', zIndex: idx }}
                  >
                    <Card value="?" isVisible={false} size="small" />
                  </div>
                ))}
              </div>
            </div>
            <div className="discard-piles-opponent">
              {player.discardPiles.map((pile, idx) => (
                <div key={idx} className="card-pile-small">
                  <div className="pile-label-small">
                    {t('game.discardShort', { index: idx + 1 })}
                  </div>
                  {pile.length > 0 ? (
                    <div className="discard-pile-stack-small">
                      {pile.map((card, cardIndex) => (
                        <div
                          key={`opponent-${idx}-${cardIndex}-${card}-${pile.length}`}
                          className="card-in-pile-small"
                          style={{ marginTop: cardIndex > 0 ? '-45px' : '0' }}
                        >
                          <Card value={card} isVisible={true} size="small" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-pile-small"></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default OpponentArea;
