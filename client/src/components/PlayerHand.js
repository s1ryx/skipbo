import React from 'react';
import Card from './Card';
import './PlayerHand.css';

function PlayerHand({ hand, selectedCard, selectedSource, onCardSelect, disabled }) {
  return (
    <div className="player-hand">
      <div className="hand-label">Your Hand</div>
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
          <div className="empty-hand">No cards in hand</div>
        )}
      </div>
    </div>
  );
}

export default PlayerHand;
