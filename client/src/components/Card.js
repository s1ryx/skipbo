import React from 'react';
import './Card.css';

function Card({ value, isVisible, size = 'normal' }) {
  const displayValue = value === 'SKIP-BO' ? 'SB' : value;

  return (
    <div className={`card ${isVisible ? 'visible' : 'hidden'} ${size} ${value === 'SKIP-BO' ? 'wild-card' : ''}`}>
      {isVisible ? (
        <div className="card-content">
          <div className="card-corner card-corner-top">{displayValue}</div>
          <div className="card-value-center">{displayValue}</div>
          <div className="card-corner card-corner-bottom">{displayValue}</div>
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
