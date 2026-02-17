# Architecture & Program Flow

This document describes how the client and server interact, how data flows
through the system, and how the React component tree is structured.

## High-Level Overview

The application is a real-time multiplayer card game with two processes:

- **Server** — Node.js + Express + Socket.IO
  ([server/server.js](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js))
- **Client** — React single-page app
  ([client/src/App.js](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js))

All game state lives on the server. The client is a thin view layer that
renders whatever the server tells it and forwards user actions back as
Socket.IO events.

```
┌──────────────────┐      Socket.IO       ┌──────────────────┐
│     Client        │◄───────────────────► │      Server      │
│    (React)        │  events + JSON       │  (Node/Express)  │
│                   │                      │                  │
│  App.js           │                      │  server.js       │
│  ├─ useGameSocket │                      │  └─ gameLogic.js │
│  ├─ Lobby         │                      │     (SkipBoGame) │
│  ├─ WaitingRoom   │                      │                  │
│  └─ GameBoard     │                      │  In-memory Maps: │
│     ├─ Card       │                      │  games, players  │
│     ├─ PlayerHand │                      │  pendingDeletions│
│     └─ Chat       │                      │                  │
└──────────────────┘                       └──────────────────┘
```

## Server Architecture

### Storage

Three in-memory maps hold all state
([server.js:31-33](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L31-L33)):

- **`games`** (`Map<roomId, SkipBoGame>`) — one game instance per room
- **`playerRooms`** (`Map<socketId, roomId>`) — tracks which room each
  connected socket belongs to
- **`pendingDeletions`** (`Map<roomId, timeoutId>`) — grace period timers
  for empty lobbies

### Game Logic

[`SkipBoGame`](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js) is a plain class that encapsulates
all game rules:

- **Deck** — 144 cards from `createDeck()`: 12 copies each of 1–12, plus
  18 SKIP-BO wilds
  ([gameLogic.js:16-29](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js#L16-L29))
- **Player model** — `{ id, name, stockpile[], hand[], discardPiles[4][] }`
  ([gameLogic.js:44-50](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js#L44-L50))
- **Building piles** — 4 shared piles that count 1→12, cleared when
  complete and recycled into the deck
  ([gameLogic.js:176-190](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js#L176-L190))
- **Turn flow** — `endTurn()` advances `currentPlayerIndex` and draws
  cards for the next player
  ([gameLogic.js:244-258](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js#L244-L258))
- **Win condition** — a player's stockpile reaches length 0
  ([gameLogic.js:198-201](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js#L198-L201))

### Two views of game state

The server exposes two projection methods to avoid leaking private data:

- **`getGameState()`** — public state visible to all players: player
  names, stockpile counts/tops, hand counts, discard piles (visible),
  building piles, current turn, game status
  ([gameLogic.js:261-280](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js#L261-L280))
- **`getPlayerState(playerId)`** — private state for one player: full hand
  contents, full stockpile contents
  ([gameLogic.js:282-292](https://github.com/s1ryx/skipbo/blob/b288213383906a184907a7c88be865c53dffd851/server/gameLogic.js#L282-L292))

Every state update sends both to the relevant player so opponents never see
each other's hands.

### Server Helpers

- **`cancelPendingDeletion(roomId)`** — clears a grace period timer when a
  player joins before the timeout expires
  ([server.js:415-424](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L415-L424))
- **`scheduleEmptyLobbyDeletion(roomId)`** — schedules room deletion after
  `LOBBY_GRACE_PERIOD_MS` (30s), with a cap of `MAX_PENDING_ROOMS` (50)
  to prevent abuse
  ([server.js:426-440](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L426-L440))
- **`generateRoomId()`** — creates a 6-character room code using
  easily-distinguishable characters
  ([server.js:442-454](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L442-L454))

### HTTP Endpoint

A single REST endpoint exists for health checks
([server.js:22-28](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L22-L28)):

```
GET /health → { status: "ok", version, timestamp }
```

## Client Architecture

### Component Tree

```
index.js
└─ <StrictMode>
   └─ <LanguageProvider>          ← i18n context
      └─ <App>                    ← routing, URL params, stable player ID
         │  └─ useGameSocket()    ← Socket.IO connection, all server state
         │
         ├─ <Lobby>               ← room creation/joining forms
         │   (when inLobby=true)
         │
         ├─ <WaitingRoom>         ← pre-game player list, shareable link
         │   (when !inLobby && !gameStarted)
         │
         └─ <GameBoard>           ← active game UI
             (when !inLobby && gameStarted)
             ├─ opponent info      ← other players' visible state
             ├─ building piles     ← shared center piles
             ├─ player area        ← stockpile, discard piles
             │  └─ <PlayerHand>    ← current player's hand cards
             │      └─ <Card>      ← individual card rendering
             ├─ actions bar        ← end turn, cancel, quick discard
             ├─ game over overlay  ← winner announcement
             ├─ leave confirm      ← confirmation dialog
             └─ <Chat>            ← collapsible chat panel
```

### State Management

All server-related state lives in the `useGameSocket` custom hook
([hooks/useGameSocket.js:18-40](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L18-L40)):

| State          | Type    | Purpose                                  |
| -------------- | ------- | ---------------------------------------- |
| `socket`       | Socket  | Socket.IO connection instance            |
| `gameState`    | object  | Public game state from server            |
| `playerState`  | object  | Private player state (hand, stockpile)   |
| `playerId`     | string  | Current socket ID                        |
| `roomId`       | string  | Current room code                        |
| `inLobby`      | boolean | Controls Lobby vs game rendering         |
| `error`        | string  | Temporary error message (auto-clears)    |
| `chatMessages` | array   | Chat history (persisted to localStorage) |

App-level state in `App.js`
([App.js:26-28](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js#L26-L28)):

| State            | Type   | Purpose                                   |
| ---------------- | ------ | ----------------------------------------- |
| `stablePlayerId` | string | Persistent ID for chat attribution        |
| `roomIdFromUrl`  | string | Room ID extracted from `?room=` URL param |

The hook returns state and action functions. Components never manage
server-related state themselves — they receive data and call callbacks.

### Component Responsibilities

**`App`** ([App.js](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js), 113 lines)

- Thin rendering shell that routes between Lobby, WaitingRoom, and GameBoard
- Extracts `?room=` URL parameter on mount
  ([App.js:30-37](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js#L30-L37))
- Generates and persists a stable player ID for chat attribution
  ([App.js:15-22](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js#L15-L22))
- Calls `useGameSocket(stablePlayerId)` for all server interaction
  ([App.js:39-57](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js#L39-L57))
- Three-way routing: `inLobby` → Lobby, `!gameStarted` → WaitingRoom,
  else → GameBoard
  ([App.js:67-91](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js#L67-L91))

**`useGameSocket`** ([hooks/useGameSocket.js](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js), 285 lines)

- Creates the Socket.IO connection on mount
  ([useGameSocket.js:49-50](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L49-L50))
- Registers all Socket.IO event listeners
  ([useGameSocket.js:53-190](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L53-L190))
- Defines 10 action functions that emit Socket.IO events
  ([useGameSocket.js:198-264](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L198-L264))
- Session persistence helpers: `clearSession()`, `saveSession()`
  ([useGameSocket.js:7-16](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L7-L16))
- Chat message persistence to localStorage
  ([useGameSocket.js:43-47](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L43-L47))

**`Lobby`** ([Lobby.js](https://github.com/s1ryx/skipbo/blob/d54aea5240e8a572c0892118406bdb2034913988/client/src/components/Lobby.js))

- Two-form UI: create room or join existing room
- Local state: player name, max players, stockpile size, room ID input
- Calls `onCreateRoom(name, maxPlayers, stockpileSize)` or
  `onJoinRoom(roomId, name)` — both passed from `App`
- Enforces stockpile size limits based on player count
  ([Lobby.js:12-14](https://github.com/s1ryx/skipbo/blob/d54aea5240e8a572c0892118406bdb2034913988/client/src/components/Lobby.js#L12-L14))

**`WaitingRoom`** ([WaitingRoom.js](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/WaitingRoom.js), 74 lines)

- Pre-game lobby view shown after room creation/join
- Displays room ID, shareable link with copy button, and player list
- Shows "Start Game" button when 2+ players present
- Calls `onStartGame` and `onLeaveLobby` — both passed from `App`
- Props: `{ gameState, playerId, roomId, onStartGame, onLeaveLobby }`

**`GameBoard`** ([GameBoard.js](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js), 390 lines)

- Active game UI (only rendered when game has started)
- Manages card selection state locally (`selectedCard`, `selectedSource`,
  `discardMode`)
  ([GameBoard.js:22-29](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L22-L29))
- Card interaction flow:
  1. Click a card → `handleCardSelect` stores it
     ([GameBoard.js:44-53](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L44-L53))
  2. Click a building pile → `handleBuildingPileClick` calls `onPlayCard`
     ([GameBoard.js:55-62](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L55-L62))
  3. Click "End Turn" → enters discard mode
     ([GameBoard.js:86-90](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L86-L90))
  4. Click a discard pile (in discard mode or quick discard) →
     `handleDiscardPileClick` calls `onDiscardCard`
     ([GameBoard.js:64-78](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L64-L78))
- Quick discard setting persisted to localStorage
  ([GameBoard.js:25-28](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L25-L28))
- Props: `{ gameState, playerState, playerId, roomId, onPlayCard,
onDiscardCard, onLeaveGame, chatMessages, onSendChatMessage,
onMarkMessagesRead, stablePlayerId }`

**`PlayerHand`** ([PlayerHand.js](https://github.com/s1ryx/skipbo/blob/5290fba7a55afb2e295f4d897c6b8a39526fcf71/client/src/components/PlayerHand.js))

- Renders the current player's hand cards horizontally
- Each card is clickable when not disabled (not your turn)
- Passes card selection up to `GameBoard` via `onCardSelect`

**`Card`** ([Card.js](https://github.com/s1ryx/skipbo/blob/5290fba7a55afb2e295f4d897c6b8a39526fcf71/client/src/components/Card.js))

- Pure presentational component for a single card
- Color-coded by value range: blue (1–4), green (5–8), red (9–12),
  wild (SKIP-BO)
  ([Card.js:8-15](https://github.com/s1ryx/skipbo/blob/5290fba7a55afb2e295f4d897c6b8a39526fcf71/client/src/components/Card.js#L8-L15))
- Supports visible/hidden (card back) and normal/small sizes

**`Chat`** ([Chat.js](https://github.com/s1ryx/skipbo/blob/5290fba7a55afb2e295f4d897c6b8a39526fcf71/client/src/components/Chat.js))

- Collapsible panel that sits inside `GameBoard`
- Tracks unread message count with a badge
  ([Chat.js:55-57](https://github.com/s1ryx/skipbo/blob/5290fba7a55afb2e295f4d897c6b8a39526fcf71/client/src/components/Chat.js#L55-L57))
- Uses `stablePlayerId` (not socket ID) to identify own messages,
  so authorship survives reconnections
  ([Chat.js:50-53](https://github.com/s1ryx/skipbo/blob/5290fba7a55afb2e295f4d897c6b8a39526fcf71/client/src/components/Chat.js#L50-L53))
- Messages persist to localStorage per room

### Session Persistence

The hook saves session data to localStorage on room creation, join,
and reconnection via `saveSession()`
([useGameSocket.js:14-16](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L14-L16)):

```json
skipBoSession: { "roomId": "ABC123", "playerId": "socket-id", "playerName": "Alice" }
```

On page reload, the `connect` handler checks for a saved session and
emits `reconnect` to rejoin the room
([useGameSocket.js:57-67](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L57-L67)).
The server updates the player's socket ID to the new connection
([server.js:147-151](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L147-L151)).

Session data is cleared via `clearSession()` on game over
([useGameSocket.js:134-148](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L134-L148))
and game abort
([useGameSocket.js:162-181](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L162-L181)).

## Socket.IO Event Reference

### Client → Server (emitted by client)

| Event             | Payload                                     | Emitted from                                                                                                                                 | Handler                                                                                                              |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createRoom`      | `{ playerName, maxPlayers, stockpileSize }` | [useGameSocket.js:199](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L199) | [server.js:42](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L42)   |
| `joinRoom`        | `{ roomId, playerName }`                    | [useGameSocket.js:205](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L205) | [server.js:62](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L62)   |
| `reconnect`       | `{ roomId, oldPlayerId, playerName }`       | [useGameSocket.js:62](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L62)   | [server.js:98](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L98)   |
| `startGame`       | _(none)_                                    | [useGameSocket.js:213](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L213) | [server.js:174](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L174) |
| `playCard`        | `{ card, source, buildingPileIndex }`       | [useGameSocket.js:219](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L219) | [server.js:202](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L202) |
| `discardCard`     | `{ card, discardPileIndex }`                | [useGameSocket.js:225](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L225) | [server.js:236](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L236) |
| `endTurn`         | _(none)_                                    | [useGameSocket.js:231](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L231) | [server.js:275](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L275) |
| `sendChatMessage` | `{ message, stablePlayerId }`               | [useGameSocket.js:257](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L257) | [server.js:305](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L305) |
| `leaveLobby`      | _(none)_                                    | [useGameSocket.js:237](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L237) | [server.js:335](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L335) |
| `leaveGame`       | _(none)_                                    | [useGameSocket.js:248](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L248) | [server.js:372](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L372) |

### Server → Client (emitted by server)

| Event                | Payload                                                        | Emitted from                                                                                                             | Listener                                                                                                                                     |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `roomCreated`        | `{ roomId, playerId, gameState }`                              | [server.js:52](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L52)       | [useGameSocket.js:70](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L70)   |
| `playerJoined`       | `{ playerId, playerName, gameState }`                          | [server.js:88](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L88)       | [useGameSocket.js:83](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L83)   |
| `playerLeft`         | `{ playerId, gameState }`                                      | [server.js:352](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L352)     | [useGameSocket.js:93](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L93)   |
| `reconnected`        | `{ roomId, playerId, gameState, playerState }`                 | [server.js:157](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L157)     | [useGameSocket.js:98](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L98)   |
| `reconnectFailed`    | `{ message }`                                                  | [server.js:102,142](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L102) | [useGameSocket.js:112](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L112) |
| `playerReconnected`  | `{ playerId, playerName }`                                     | [server.js:165](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L165)     | _(not handled)_                                                                                                                              |
| `gameStarted`        | `{ gameState, playerState }`                                   | [server.js:192](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L192)     | [useGameSocket.js:119](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L119) |
| `gameStateUpdate`    | `{ gameState, playerState }`                                   | [server.js:220,262](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L220) | [useGameSocket.js:125](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L125) |
| `turnChanged`        | `{ currentPlayerId }`                                          | [server.js:269,300](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L269) | [useGameSocket.js:130](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L130) |
| `gameOver`           | `{ winner, gameState }`                                        | [server.js:228](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L228)     | [useGameSocket.js:134](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L134) |
| `playerDisconnected` | `{ playerId }`                                                 | [server.js:403](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L403)     | [useGameSocket.js:150](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L150) |
| `gameAborted`        | _(none)_                                                       | [server.js:380](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L380)     | [useGameSocket.js:162](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L162) |
| `chatMessage`        | `{ playerId, playerName, stablePlayerId, message, timestamp }` | [server.js:323](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L323)     | [useGameSocket.js:183](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L183) |
| `error`              | `{ message }`                                                  | [various](https://github.com/s1ryx/skipbo/blob/5a448aeb5b3cf328eac51e5243b32f19f65d25e4/server/server.js#L66)            | [useGameSocket.js:187](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L187) |

## Game Flow

### 1. Room Creation

```
Player A opens app
  → App mounts, useGameSocket creates connection  (useGameSocket.js:49-50)
  → Player fills out lobby form                   (Lobby.js)
  → Lobby calls onCreateRoom(name, max, size)     (useGameSocket.js:198-202)
  → Client emits 'createRoom'                     (useGameSocket.js:200)
  → Server creates SkipBoGame instance            (server.js:44)
  → Server stores in games Map                    (server.js:47)
  → Server emits 'roomCreated' to creator         (server.js:52-56)
  → Hook sets roomId, gameState, inLobby=false    (useGameSocket.js:70-80)
  → App renders WaitingRoom                       (App.js:69-76)
```

### 2. Joining a Room

```
Player B opens app, enters room code
  → Lobby calls onJoinRoom(roomId, name)          (useGameSocket.js:204-210)
  → Client emits 'joinRoom'                       (useGameSocket.js:206)
  → Server validates room exists, not full        (server.js:65-82)
  → Server adds player to SkipBoGame              (server.js:77)
  → Server emits 'playerJoined' to ALL in room    (server.js:88-92)
  → Both clients update gameState                 (useGameSocket.js:83-91)
  → Player list updates in WaitingRoom
```

### 3. Starting the Game

```
Any player clicks "Start Game"
  → WaitingRoom calls onStartGame                 (WaitingRoom.js:62)
  → Client emits 'startGame'                      (useGameSocket.js:214)
  → Server calls game.startGame()                 (server.js:183)
    → Deck created and shuffled                   (gameLogic.js:61)
    → Stockpiles dealt (20-30 cards each)         (gameLogic.js:71-75)
    → Hands dealt (5 cards each)                  (gameLogic.js:78-80)
  → Server sends 'gameStarted' to EACH player    (server.js:191-196)
    (each gets their own playerState)
  → App routing switches to GameBoard             (App.js:77-91)
```

### 4. Playing a Card

```
Player clicks a card source (hand/stockpile/discard top)
  → handleCardSelect stores card + source         (GameBoard.js:44-53)
  → UI highlights the selected card

Player clicks a building pile
  → handleBuildingPileClick fires                 (GameBoard.js:55-62)
  → Client emits 'playCard'                       (useGameSocket.js:220)
  → Server calls game.playCard()                  (server.js:211)
    → Validates: correct turn, valid move         (gameLogic.js:136-145)
    → Removes card from source                    (gameLogic.js:148-167)
    → Adds card to building pile                  (gameLogic.js:174)
    → If pile reaches 12: recycle into deck       (gameLogic.js:182-190)
    → If hand empty: auto-draw 5 cards            (gameLogic.js:193-195)
    → If stockpile empty: player wins             (gameLogic.js:198-201)
  → Server sends 'gameStateUpdate' to each        (server.js:219-224)
  → If game over: server sends 'gameOver'         (server.js:227-232)
```

### 5. Discarding and Ending a Turn

```
Player clicks "End Turn (Discard a Card)"
  → handleEndTurn sets discardMode=true           (GameBoard.js:86-90)
  → UI highlights discard piles as targets

Player clicks a discard pile
  → handleDiscardPileClick fires                  (GameBoard.js:64-78)
  → Client emits 'discardCard'                    (useGameSocket.js:226)
  → Server calls game.discardCard()               (server.js:245)
    → Removes card from hand                      (gameLogic.js:217-224)
    → Adds to chosen discard pile                 (gameLogic.js:224)
  → Server calls game.endTurn()                   (server.js:253)
    → Advances currentPlayerIndex                 (gameLogic.js:252)
    → Draws cards for next player                 (gameLogic.js:255-256)
  → Server sends 'gameStateUpdate' + 'turnChanged' (server.js:261-271)
```

### 6. Chat

```
Player types message and submits
  → Chat calls onSendMessage(text)                (Chat.js:34-39)
  → Hook emits 'sendChatMessage'                  (useGameSocket.js:258)
  → Server broadcasts 'chatMessage' to room       (server.js:323-329)
  → All clients append to chatMessages            (useGameSocket.js:183-185)
  → Messages saved to localStorage per room       (useGameSocket.js:43-47)
```

### 7. Reconnection

```
Player reloads page
  → App mounts, useGameSocket creates connection  (useGameSocket.js:49-50)
  → On 'connect', checks localStorage             (useGameSocket.js:57-67)
  → If session found, emits 'reconnect'           (useGameSocket.js:62)
  → Server finds player by old ID                 (server.js:109)
  → Server swaps old socket ID for new            (server.js:147-151)
  → Server sends 'reconnected' with full state    (server.js:157-162)
  → Hook restores game state                      (useGameSocket.js:98-110)
```

### 8. Leaving / Disconnect

```
Player clicks "Leave Game" in waiting room
  → Client emits 'leaveLobby'                     (useGameSocket.js:238)
  → Server removes player from room               (server.js:344-346)
  → If empty: schedules deletion after grace period (server.js:348)
  → If others remain: emits 'playerLeft'           (server.js:351-355)

Player clicks "Leave Game" during active game
  → Client emits 'leaveGame'                       (useGameSocket.js:252)
  → Server emits 'gameAborted' to entire room      (server.js:380)
  → Server deletes game from Map                   (server.js:389)
  → All clients return to lobby                    (useGameSocket.js:162-181)

Player disconnects (tab close, network loss)
  → Server 'disconnect' handler fires              (server.js:397)
  → If pre-game: removes player, may schedule deletion (server.js:404-401)
  → If mid-game: emits 'playerDisconnected'        (server.js:403-405)
    → Room persists for reconnection
```

## Data Flow Diagram

```
                   Props (↓)              Callbacks (↑)
                ┌─────────────────────────────────────────┐
                │               App.js                     │
                │  useGameSocket() → state + actions       │
                │  stablePlayerId, roomIdFromUrl           │
                └─┬──────────────┬───────────┬────────────┘
        inLobby?  │  !gameStarted?│           │  gameStarted?
                  ▼              ▼            ▼
          ┌──────────┐  ┌─────────────┐  ┌────────────────┐
          │  Lobby   │  │ WaitingRoom │  │   GameBoard    │
          │          │  │             │  │                │
          │ onCreate │  │ gameState   │  │ gameState      │
          │ onJoin   │  │ onStartGame │  │ playerState    │
          └──────────┘  │ onLeaveLobby│  │ onPlayCard     │
                        └─────────────┘  │ onDiscardCard  │
                                         │ onLeaveGame    │
                                         │ chatMessages   │
                                         │ onSendChat     │
                                         └─┬───┬───┬──────┘
                                           │   │   │
                                   ┌───────┘   │   └───────┐
                                   ▼           ▼           ▼
                             ┌──────────┐ ┌──────────┐ ┌──────┐
                             │PlayerHand│ │   Chat   │ │ Card │
                             │          │ │          │ │      │
                             │hand[]    │ │messages[]│ │value │
                             │onSelect  │ │onSend    │ │size  │
                             └─┬────────┘ └──────────┘ └──────┘
                               │
                               ▼
                            ┌──────┐
                            │ Card │ (one per card in hand)
                            └──────┘
```

## localStorage Keys

| Key                    | Value                              | Used by                                                                                                                                                             |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skipBoSession`        | `{ roomId, playerId, playerName }` | Reconnection on reload ([useGameSocket.js:14](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L14)) |
| `skipBoChat_{roomId}`  | `[{ message, playerName, ... }]`   | Chat persistence ([useGameSocket.js:45](https://github.com/s1ryx/skipbo/blob/cb5ffde9686524bfde73c8605a743e11a3670460/client/src/hooks/useGameSocket.js#L45))       |
| `skipBoStablePlayerId` | `"player_abc123_1234567890"`       | Chat message attribution ([App.js:15-22](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/App.js#L15-L22))                  |
| `skipBoQuickDiscard`   | `"true"` or `"false"`              | Quick discard setting ([GameBoard.js:26](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L26))     |
