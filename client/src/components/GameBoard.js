import React, { useState } from 'react';
import './GameBoard.css';
import Chat from './Chat';
import LeaveConfirmDialog from './LeaveConfirmDialog';
import GameOverOverlay from './GameOverOverlay';
import OpponentArea from './OpponentArea';
import BuildingPiles from './BuildingPiles';
import PlayerArea from './PlayerArea';
import OptionsMenu from './OptionsMenu';
import { useTranslation } from '../i18n';

function GameBoard({
  gameState,
  playerState,
  playerId,
  roomId,
  onPlayCard,
  onDiscardCard,
  onPassTurn,
  onLeaveGame,
  onRequestRematch,
  onUpdateRematchSettings,
  rematchVotes,
  rematchStockpileSize,
  chatMessages,
  onSendChatMessage,
  onMarkMessagesRead,
}) {
  const { t } = useTranslation();
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedSource, setSelectedSource] = useState(null);
  const [discardMode, setDiscardMode] = useState(false);
  const [quickDiscardEnabled, setQuickDiscardEnabled] = useState(() => {
    const saved = localStorage.getItem('skipBoQuickDiscard');
    return saved === 'true';
  });
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  if (!gameState) {
    return <div className="loading">{t('game.loadingGame')}</div>;
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

    // Toggle off if clicking the same card again
    if (selectedCard === card && selectedSource === source) {
      setSelectedCard(null);
      setSelectedSource(null);
      return;
    }

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

  const handleCancelDiscard = () => {
    setDiscardMode(false);
    setSelectedCard(null);
    setSelectedSource(null);
  };

  const turnText = isMyTurn
    ? discardMode
      ? playerState?.hand.length === 0
        ? t('game.noCardsToDiscard')
        : t('game.discardInstruction')
      : t('game.yourTurn')
    : t('game.waitingTurn');

  return (
    <div className="game-board">
      <OptionsMenu
        roomId={roomId}
        quickDiscardEnabled={quickDiscardEnabled}
        onToggleQuickDiscard={toggleQuickDiscard}
        onLeaveGame={() => setShowLeaveConfirm(true)}
      />

      <OpponentArea
        opponents={gameState.players.filter((p) => p.id !== playerId)}
        currentPlayerId={gameState.currentPlayerId}
      />

      <BuildingPiles
        piles={gameState.buildingPiles}
        isClickable={selectedCard && isMyTurn && !discardMode}
        onPileClick={handleBuildingPileClick}
        isMyTurn={isMyTurn}
        turnText={turnText}
      />

      {playerState && (
        <PlayerArea
          playerState={playerState}
          isMyTurn={isMyTurn}
          selectedCard={selectedCard}
          selectedSource={selectedSource}
          discardMode={discardMode}
          quickDiscardEnabled={quickDiscardEnabled}
          onCardSelect={handleCardSelect}
          onDiscardPileClick={handleDiscardPileClick}
          onEndTurn={handleEndTurn}
          onPassTurn={onPassTurn}
          onCancelDiscard={handleCancelDiscard}
          onClearSelection={() => {
            setSelectedCard(null);
            setSelectedSource(null);
          }}
        />
      )}

      {showLeaveConfirm && (
        <LeaveConfirmDialog onConfirm={onLeaveGame} onCancel={() => setShowLeaveConfirm(false)} />
      )}

      {gameState.gameOver && (
        <GameOverOverlay
          gameState={gameState}
          playerId={playerId}
          rematchVotes={rematchVotes}
          rematchStockpileSize={rematchStockpileSize}
          onRequestRematch={onRequestRematch}
          onUpdateRematchSettings={onUpdateRematchSettings}
          onLeaveGame={onLeaveGame}
        />
      )}

      <Chat
        messages={chatMessages}
        onSendMessage={onSendChatMessage}
        onMarkMessagesRead={onMarkMessagesRead}
        playerId={playerId}
      />
    </div>
  );
}

export default GameBoard;
