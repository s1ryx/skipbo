import React from 'react';
import Card from './Card';
import { getNextCardForPile } from '../utils/cardUtils';
import { useTranslation } from '../i18n';

function BuildingPiles({ piles, isClickable, onPileClick }) {
  const { t } = useTranslation();

  return (
    <div className="building-piles">
      <h3>{t('game.buildingPiles')}</h3>
      <div className="piles-container">
        {piles.map((pile, index) => (
          <div
            key={index}
            className={`building-pile ${isClickable ? 'clickable' : ''}`}
            onClick={() => onPileClick(index)}
          >
            <div className="pile-info">
              {t('game.pile', { index: index + 1 })}
              {pile.length > 0 && (
                <span className="next-card">
                  {getNextCardForPile(pile)
                    ? t('game.nextCard', { value: getNextCardForPile(pile) })
                    : t('game.pileComplete')}
                </span>
              )}
            </div>
            {pile.length > 0 ? (
              <div className="pile-stack">
                <Card value={pile[pile.length - 1]} isVisible={true} />
                <div className="pile-count">{t('game.cards', { count: pile.length })}</div>
              </div>
            ) : (
              <div className="empty-pile">
                <div className="empty-pile-text">{t('game.startWith1')}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default BuildingPiles;
