import React, { useState, useEffect } from 'react';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import GameBoard from './components/GameBoard';
import Lobby from './components/Lobby';
import WaitingRoom from './components/WaitingRoom';
import { useTranslation } from './i18n';
import useGameConnection from './useGameConnection';

const VERSION = require('../package.json').version;
const COMMIT_HASH = process.env.REACT_APP_COMMIT_HASH;

function App() {
  const { t, language, setLanguage, supportedLanguages } = useTranslation();
  const [roomIdFromUrl, setRoomIdFromUrl] = useState(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const roomIdUpper = roomParam.toUpperCase();
      window.history.replaceState({}, document.title, window.location.pathname);

      // Try to hand off the room code to an existing tab
      const channel = new BroadcastChannel('skipbo-lobby');
      channel.onmessage = (e) => {
        if (e.data.type === 'joinRoom:ack') {
          channel.close();
          window.close();
        }
      };
      channel.postMessage({ type: 'joinRoom', roomId: roomIdUpper });
      setTimeout(() => channel.close(), 1000);

      // Also proceed normally in case close fails or no other tab is listening
      setRoomIdFromUrl(roomIdUpper);
    }
  }, []);

  const {
    gameState,
    playerState,
    playerId,
    roomId,
    inLobby,
    error,
    chatMessages,
    createRoom,
    joinRoom,
    startGame,
    playCard,
    discardCard,
    leaveLobby,
    leaveGame,
    requestRematch,
    updateRematchSettings,
    rematchVotes,
    rematchStockpileSize,
    sendChatMessage,
    markMessagesAsRead,
    addBot,
    removeBot,
  } = useGameConnection();

  return (
    <ErrorBoundary>
    <div className="App">
      <header className="App-header">
        <h1>{t('app.title')}</h1>
      </header>

      {error && <div className="error-message">{t(error)}</div>}

      {inLobby ? (
        <Lobby onCreateRoom={createRoom} onJoinRoom={joinRoom} initialRoomId={roomIdFromUrl} />
      ) : !gameState?.gameStarted ? (
        <WaitingRoom
          gameState={gameState}
          playerId={playerId}
          roomId={roomId}
          onStartGame={startGame}
          onLeaveLobby={leaveLobby}
          onAddBot={addBot}
          onRemoveBot={removeBot}
        />
      ) : (
        <GameBoard
          gameState={gameState}
          playerState={playerState}
          playerId={playerId}
          roomId={roomId}
          onPlayCard={playCard}
          onDiscardCard={discardCard}
          onLeaveGame={leaveGame}
          onRequestRematch={requestRematch}
          onUpdateRematchSettings={updateRematchSettings}
          rematchVotes={rematchVotes}
          rematchStockpileSize={rematchStockpileSize}
          chatMessages={chatMessages}
          onSendChatMessage={sendChatMessage}
          onMarkMessagesRead={markMessagesAsRead}
        />
      )}

      <footer className="App-footer">
        <span className="version">
          v{VERSION}
          {COMMIT_HASH && ` (${COMMIT_HASH})`}
        </span>
        <select
          className="language-selector"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {supportedLanguages.map((lang) => (
            <option key={lang} value={lang}>
              {t(`language.${lang}`)}
            </option>
          ))}
        </select>
      </footer>
    </div>
    </ErrorBoundary>
  );
}

export default App;
