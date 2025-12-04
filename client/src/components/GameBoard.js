import React, { useState } from 'react';
import './GameBoard.css';
import Card from './Card';
import PlayerHand from './PlayerHand';
import Chat from './Chat';

function GameBoard({
  gameState,
  playerState,
  playerId,
  roomId,
  onStartGame,
  onPlayCard,
  onDiscardCard,
  onEndTurn,
  onLeaveGame,
  chatMessages,
  onSendChatMessage,
  onMarkMessagesRead,
  stablePlayerId
}) {
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedSource, setSelectedSource] = useState(null);
  const [discardMode, setDiscardMode] = useState(false);
  const [quickDiscardEnabled, setQuickDiscardEnabled] = useState(() => {
    const saved = localStorage.getItem('skipBoQuickDiscard');
    return saved === 'true';
  });

  if (!gameState) {
    return <div className="loading">Loading game...</div>;
  }

  const isMyTurn = gameState.currentPlayerId === playerId;

  const getSourceType = (source) => {
    if (!source) return null;
    if (source.startsWith('hand-')) return 'hand';
    if (source.startsWith('discard')) return source;
    return source;
  };

  const handleCardSelect = (card, source) => {
    if (!isMyTurn) return;

    // In discard mode, only allow selecting cards from hand
    const sourceType = getSourceType(source);
    if (discardMode && sourceType !== 'hand') return;

    setSelectedCard(card);
    setSelectedSource(source);
  };

  const handleBuildingPileClick = (pileIndex) => {
    if (!isMyTurn || !selectedCard || discardMode) return;

    const sourceType = getSourceType(selectedSource);
    onPlayCard(selectedCard, sourceType, pileIndex);
    setSelectedCard(null);
    setSelectedSource(null);
  };

  const handleDiscardPileClick = (pileIndex) => {
    if (!isMyTurn || !selectedCard) return;

    // Only allow discarding cards from hand
    const sourceType = getSourceType(selectedSource);
    if (sourceType !== 'hand') return;

    // Quick discard: allow immediate discard if enabled, otherwise require discard mode
    if (!quickDiscardEnabled && !discardMode) return;

    onDiscardCard(selectedCard, pileIndex);
    setSelectedCard(null);
    setSelectedSource(null);
    setDiscardMode(false);
  };

  const toggleQuickDiscard = () => {
    const newValue = !quickDiscardEnabled;
    setQuickDiscardEnabled(newValue);
    localStorage.setItem('skipBoQuickDiscard', newValue.toString());
  };

  const handleEndTurn = () => {
    if (!isMyTurn) return;

    setDiscardMode(true);
  };

  const getNextCardForPile = (pile) => {
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
  };

  if (!gameState.gameStarted) {
    return (
      <div className="waiting-room">
        <h2>Room: {roomId}</h2>
        <p>Share this room ID with your friends!</p>

        <div className="players-waiting">
          <h3>Players ({gameState.players.length}/{gameState.players.length}):</h3>
          <ul>
            {gameState.players.map(player => (
              <li key={player.id}>
                {player.name} {player.id === playerId ? '(You)' : ''}
              </li>
            ))}
          </ul>
        </div>

        {gameState.players.length >= 2 && (
          <button onClick={onStartGame} className="btn-primary">
            Start Game
          </button>
        )}

        {gameState.players.length < 2 && (
          <p>Waiting for more players to join...</p>
        )}
      </div>
    );
  }

  return (
    <div className="game-board">
      <div className="game-header">
        <h3>Room: {roomId}</h3>
        <div className={`turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
          {isMyTurn ? "Your Turn!" : "Waiting for other player..."}
        </div>
        <button onClick={onLeaveGame} className="btn-leave-game">
          Leave Game
        </button>
        {discardMode && (
          <div className="discard-instruction">
            Click on one of your discard piles to end your turn
          </div>
        )}
      </div>

      {/* Other Players */}
      <div className="other-players">
        {gameState.players
          .filter(p => p.id !== playerId)
          .map(player => (
            <div key={player.id} className={`opponent-info ${gameState.currentPlayerId !== player.id ? 'inactive' : ''}`}>
              <h4>
                {player.name}
                {gameState.currentPlayerId === player.id && ' (Playing)'}
                {player.disconnected && <span className="disconnected-indicator"> (Disconnected)</span>}
              </h4>
              <div className="opponent-cards">
                <div className="card-pile">
                  <div className="pile-label">Stockpile: {player.stockpileCount}</div>
                  {player.stockpileTop && (
                    <Card value={player.stockpileTop} isVisible={true} />
                  )}
                </div>
                <div className="card-pile">
                  <div className="pile-label">Hand: {player.handCount}</div>
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
                      <div className="pile-label-small">D{idx + 1}</div>
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

      {/* Building Piles (Center) */}
      <div className="building-piles">
        <h3>Building Piles</h3>
        <div className="piles-container">
          {gameState.buildingPiles.map((pile, index) => (
            <div
              key={index}
              className={`building-pile ${selectedCard && isMyTurn && !discardMode ? 'clickable' : ''}`}
              onClick={() => handleBuildingPileClick(index)}
            >
              <div className="pile-info">
                Pile {index + 1}
                {pile.length > 0 && (
                  <span className="next-card">
                    Next: {getNextCardForPile(pile) || 'Complete'}
                  </span>
                )}
              </div>
              {pile.length > 0 ? (
                <div className="pile-stack">
                  <Card value={pile[pile.length - 1]} isVisible={true} />
                  <div className="pile-count">{pile.length} {pile.length === 1 ? 'card' : 'cards'}</div>
                </div>
              ) : (
                <div className="empty-pile">
                  <div className="empty-pile-text">Start with 1</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Current Player Area */}
      {playerState && (
        <div className={`player-area ${!isMyTurn ? 'inactive' : ''}`}>
          <h3>Your Area</h3>

          <div className="player-piles">
            {/* Stockpile */}
            <div className="stockpile-section">
              <div className="pile-label">Your Stockpile ({playerState.stockpile.length})</div>
              {playerState.stockpileTop ? (
                <div
                  className={`card-clickable ${selectedCard === playerState.stockpileTop && selectedSource === 'stockpile' ? 'selected' : ''}`}
                  onClick={() => handleCardSelect(playerState.stockpileTop, 'stockpile')}
                >
                  <Card value={playerState.stockpileTop} isVisible={true} />
                </div>
              ) : (
                <div className="empty-message">Empty! You win!</div>
              )}
            </div>

            {/* Discard Piles */}
            <div className="discard-piles-section">
              <div className="pile-label">Your Discard Piles</div>
              <div className="discard-piles-container">
                {playerState.discardPiles.map((pile, index) => (
                  <div
                    key={index}
                    className={`discard-pile ${discardMode ? 'discard-mode' : ''}`}
                    onClick={() => handleDiscardPileClick(index)}
                  >
                    <div className="pile-label-small">Pile {index + 1}</div>
                    {pile.length > 0 ? (
                      <div className="discard-pile-stack">
                        {pile.map((card, cardIndex) => (
                          <div
                            key={`${index}-${cardIndex}-${card}-${pile.length}`}
                            className={`card-in-pile ${cardIndex === pile.length - 1 ? 'top-card' : ''} ${selectedCard === card && cardIndex === pile.length - 1 && selectedSource === `discard${index}` ? 'selected' : ''}`}
                            style={{ marginTop: cardIndex > 0 ? '-50px' : '0' }}
                            onClick={(e) => {
                              // If in discard mode, allow click to bubble up to discard
                              if (discardMode) {
                                return;
                              }
                              // If a hand card is selected and quick discard is enabled, allow click to bubble up
                              const sourceType = getSourceType(selectedSource);
                              if (quickDiscardEnabled && selectedCard && sourceType === 'hand') {
                                return;
                              }
                              // Only allow selecting the top card for playing
                              if (cardIndex === pile.length - 1) {
                                e.stopPropagation();
                                handleCardSelect(card, `discard${index}`);
                              }
                            }}
                          >
                            <Card value={card} isVisible={true} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-pile-small">
                        {discardMode ? 'Click to discard' : 'Empty'}
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
            onCardSelect={handleCardSelect}
            disabled={!isMyTurn}
          />

          {/* Actions */}
          <div className="actions">
            {isMyTurn && !discardMode && (
              <button onClick={handleEndTurn} className="btn-end-turn">
                End Turn (Discard a Card)
              </button>
            )}
            {selectedCard && (
              <div className="selected-card-info">
                Selected: <Card value={selectedCard} isVisible={true} size="small" />
                <button onClick={() => { setSelectedCard(null); setSelectedSource(null); }}>
                  Cancel
                </button>
              </div>
            )}
            <div className="settings-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={quickDiscardEnabled}
                  onChange={toggleQuickDiscard}
                />
                Quick Discard (click discard pile with selected card)
              </label>
            </div>
          </div>
        </div>
      )}

      {gameState.gameOver && (
        <div className="game-over-overlay">
          <div className="game-over-message">
            <h2>Game Over!</h2>
            <p>Winner: {gameState.winner?.name}</p>
          </div>
        </div>
      )}

      <Chat
        messages={chatMessages}
        onSendMessage={onSendChatMessage}
        onMarkMessagesRead={onMarkMessagesRead}
        stablePlayerId={stablePlayerId}
      />
    </div>
  );
}

export default GameBoard;
