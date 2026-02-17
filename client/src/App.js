import React, { useState, useEffect } from 'react';
import './App.css';
import GameBoard from './components/GameBoard';
import Lobby from './components/Lobby';
import { useTranslation } from './i18n';
import useGameSocket from './hooks/useGameSocket';

const VERSION = require('../package.json').version;
const COMMIT_HASH = process.env.REACT_APP_COMMIT_HASH;

const generatePlayerUniqueId = () => {
  return 'player_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
};

const getStablePlayerId = () => {
  let stableId = localStorage.getItem('skipBoStablePlayerId');
  if (!stableId) {
    stableId = generatePlayerUniqueId();
    localStorage.setItem('skipBoStablePlayerId', stableId);
  }
  return stableId;
};

function App() {
  const { t, language, setLanguage, supportedLanguages } = useTranslation();
  const [stablePlayerId] = useState(getStablePlayerId());
  const [roomIdFromUrl, setRoomIdFromUrl] = useState(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setRoomIdFromUrl(roomParam.toUpperCase());
      window.history.replaceState({}, document.title, window.location.pathname);
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
    endTurn,
    leaveLobby,
    leaveGame,
    sendChatMessage,
    markMessagesAsRead,
  } = useGameSocket(stablePlayerId);

  return (
    <div className="App">
      <header className="App-header">
        <h1>{t('app.title')}</h1>
      </header>

      {error && <div className="error-message">{t(error)}</div>}

      {inLobby ? (
        <Lobby onCreateRoom={createRoom} onJoinRoom={joinRoom} initialRoomId={roomIdFromUrl} />
      ) : (
        <GameBoard
          gameState={gameState}
          playerState={playerState}
          playerId={playerId}
          roomId={roomId}
          onStartGame={startGame}
          onPlayCard={playCard}
          onDiscardCard={discardCard}
          onEndTurn={endTurn}
          onLeaveLobby={leaveLobby}
          onLeaveGame={leaveGame}
          chatMessages={chatMessages}
          onSendChatMessage={sendChatMessage}
          onMarkMessagesRead={markMessagesAsRead}
          stablePlayerId={stablePlayerId}
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
  );
}

export default App;
