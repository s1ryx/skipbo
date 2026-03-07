import React from 'react';
import Card from './Card';
import PlayerHand from './PlayerHand';
import { useTranslation } from '../i18n';

function PlayerArea({
  playerState,
  isMyTurn,
  selectedCard,
  selectedSource,
  discardMode,
  quickDiscardEnabled,
  onCardSelect,
  onDiscardPileClick,
  onEndTurn,
  onPassTurn,
  onCancelDiscard,
  onClearSelection,
}) {
  const { t } = useTranslation();

  const canDiscard =
    discardMode || (quickDiscardEnabled && selectedCard && selectedSource?.startsWith('hand-'));

  return (
    <div className={`player-area ${!isMyTurn ? 'inactive' : ''}`}>
      <div className="player-piles">
        {/* Stockpile */}
        <div className="stockpile-section">
          <div className="pile-label">
            {t('game.yourStockpile', { count: playerState.stockpileCount })}
          </div>
          {playerState.stockpileTop ? (
            <div
              className={`card-clickable ${selectedCard === playerState.stockpileTop && selectedSource === 'stockpile' ? 'selected' : ''}`}
              onClick={() => onCardSelect(playerState.stockpileTop, 'stockpile')}
            >
              <Card value={playerState.stockpileTop} isVisible={true} />
            </div>
          ) : (
            <div className="empty-message">{t('game.emptyWin')}</div>
          )}
        </div>

        {/* Discard Piles */}
        <div className="discard-piles-section">
          <div className="pile-label">{t('game.yourDiscardPiles')}</div>
          <div className="discard-piles-container">
            {playerState.discardPiles.map((pile, index) => (
              <div
                key={index}
                className={`discard-pile ${discardMode ? 'discard-mode' : ''} ${canDiscard ? 'discard-target' : ''}`}
                onClick={() => onDiscardPileClick(index)}
              >
                <div className="pile-label-small">{t('game.pile', { index: index + 1 })}</div>
                {pile.length > 0 ? (
                  <div className="discard-pile-stack">
                    {pile.map((card, cardIndex) => (
                      <div
                        key={`${index}-${cardIndex}-${card}-${pile.length}`}
                        className={`card-in-pile ${cardIndex === pile.length - 1 ? 'top-card' : ''} ${selectedCard === card && cardIndex === pile.length - 1 && selectedSource === `discard${index}` ? 'selected' : ''}`}
                        onClick={(e) => {
                          if (discardMode) {
                            return;
                          }
                          if (
                            quickDiscardEnabled &&
                            selectedCard &&
                            selectedSource?.startsWith('hand-')
                          ) {
                            return;
                          }
                          if (cardIndex === pile.length - 1) {
                            e.stopPropagation();
                            onCardSelect(card, `discard${index}`);
                          }
                        }}
                      >
                        <Card value={card} isVisible={true} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-pile-small">
                    {canDiscard ? t('game.clickToDiscard') : t('game.empty')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Player Hand */}
      <PlayerHand
        hand={playerState.hand}
        selectedCard={selectedCard}
        selectedSource={selectedSource}
        onCardSelect={onCardSelect}
        disabled={!isMyTurn}
      />

      {/* Actions */}
      <div className="actions">
        {isMyTurn && !discardMode && (
          <button onClick={onEndTurn} className="btn-end-turn">
            {t('game.endTurn')}
          </button>
        )}
        {isMyTurn && discardMode && playerState.hand.length === 0 && (
          <button onClick={onPassTurn} className="btn-pass-turn">
            {t('game.passTurn')}
          </button>
        )}
        {isMyTurn && discardMode && playerState.hand.length > 0 && (
          <button onClick={onCancelDiscard} className="btn-cancel-discard">
            {t('game.cancel')}
          </button>
        )}
        {selectedCard && (
          <div className="selected-card-info">
            {t('game.selected')} <Card value={selectedCard} isVisible={true} size="small" />
            <button onClick={onClearSelection}>{t('game.cancel')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerArea;
