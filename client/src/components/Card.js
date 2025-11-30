import React from 'react';
import './Card.css';

function Card({ value, isVisible, size = 'normal' }) {
  const displayValue = value === 'SKIP-BO' ? 'S-B' : value;

  return (
    <div className={`card ${isVisible ? 'visible' : 'hidden'} ${size} ${value === 'SKIP-BO' ? 'wild-card' : ''}`}>
      {isVisible ? (
        <div className="card-content">
          <div className="card-value">{displayValue}</div>
          {value === 'SKIP-BO' && <div className="wild-indicator">WILD</div>}
        </div>
      ) : (
        <div className="card-back">
          <div className="card-pattern"></div>
        </div>
      )}
    </div>
  );
}

export default Card;
