import React from 'react';
import Card from './Card';
import { useTranslation } from '../i18n';

function getNextCardForPile(pile) {
  if (pile.length === 0) return 1;

  const lastCard = pile[pile.length - 1];
  if (lastCard === 'SKIP-BO') {
    let value = 0;
    for (let i = 0; i < pile.length; i++) {
      if (pile[i] !== 'SKIP-BO') {
        value = pile[i];
      } else {
        value++;
      }
    }
    return value === 12 ? null : value + 1;
  }

  return lastCard === 12 ? null : lastCard + 1;
}

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

export { getNextCardForPile };
export default BuildingPiles;
