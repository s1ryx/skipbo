# Architecture & Program Flow

This document describes how the client and server interact, how data flows
through the system, and how the React component tree is structured.

## High-Level Overview

The application is a real-time multiplayer card game with two processes:

- **Server** — Node.js + Express + Socket.IO
  ([server/server.js](https://github.com/s1ryx/skipbo/blob/75194bc0bf82641168040336e87a6736a786fc90/server/server.js))
- **Client** — React single-page app
  ([client/src/App.js](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/App.js))

All game state lives on the server. The client is a thin view layer that
renders whatever the server tells it and forwards user actions back through
an abstracted transport layer.

```
┌──────────────────────┐   Transport    ┌──────────────────────────┐
│       Client          │◄────────────► │          Server           │
│      (React)          │ events + JSON │      (Node/Express)       │
│                       │               │                           │
│  App.js               │               │  server.js (wiring)       │
│  ├─ useGameConnection │               │  ├─ gameCoordinator.js    │
│  │   └─ SocketIO-     │               │  │  └─ gameLogic.js       │
│  │     ClientTransport│               │  │     (SkipBoGame)       │
│  ├─ Lobby             │               │  └─ transport/            │
│  ├─ WaitingRoom       │               │     └─ SocketIOTransport  │
│  └─ GameBoard         │               │                           │
│     ├─ Card           │               │  In-memory Maps:          │
│     ├─ PlayerHand     │               │  games, playerRooms,      │
│     └─ Chat           │               │  pendingDeletions         │
└──────────────────────┘                └──────────────────────────┘
```

## Transport Abstraction

Game logic and UI are fully decoupled from the wire protocol. Both server
and client communicate through transport adapters that expose a small,
generic interface. Swapping Socket.IO for a different transport (e.g.,
SSE + REST) requires only writing a new adapter — no changes to the
game coordinator or React components.

### Server Transport Interface

[`SocketIOTransport`](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js)
implements:

| Method | Socket.IO equivalent | Line |
|---|---|---|
| `send(connectionId, event, data)` | `io.to(socketId).emit(event, data)` | [55-57](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js#L55-L57) |
| `sendToGroup(groupId, event, data)` | `io.to(roomId).emit(event, data)` | [60-62](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js#L60-L62) |
| `sendToGroupExcept(groupId, excludeId, event, data)` | `io.to(roomId).except(id).emit(...)` | [65-67](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js#L65-L67) |
| `addToGroup(connectionId, groupId)` | `socket.join(roomId)` | [70-75](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js#L70-L75) |
| `removeFromGroup(connectionId, groupId)` | `socket.leave(roomId)` | [78-83](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js#L78-L83) |

The adapter accepts three handler callbacks on construction
([SocketIOTransport.js:24-27](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js#L24-L27)):
`onConnect(connectionId)`, `onDisconnect(connectionId)`,
`onMessage(connectionId, event, data)`.

All 11 known client events are forwarded through the single `onMessage`
dispatcher
([SocketIOTransport.js:4-15](https://github.com/s1ryx/skipbo/blob/7d064cf97611fe1eeedec1cf762fdd964c3332d3/server/transport/SocketIOTransport.js#L4-L15)).

### Client Transport Interface

[`SocketIOClientTransport`](https://github.com/s1ryx/skipbo/blob/760826fa15e14d031bccbcd18d89a48139873ed2/client/src/transport/SocketIOClientTransport.js)
implements:

| Method | Socket.IO equivalent | Line |
|---|---|---|
| `connect()` | `io(url)` | [34-51](https://github.com/s1ryx/skipbo/blob/760826fa15e14d031bccbcd18d89a48139873ed2/client/src/transport/SocketIOClientTransport.js#L34-L51) |
| `send(event, data)` | `socket.emit(event, data)` | [54-58](https://github.com/s1ryx/skipbo/blob/760826fa15e14d031bccbcd18d89a48139873ed2/client/src/transport/SocketIOClientTransport.js#L54-L58) |
| `disconnect()` | `socket.close()` | [61-66](https://github.com/s1ryx/skipbo/blob/760826fa15e14d031bccbcd18d89a48139873ed2/client/src/transport/SocketIOClientTransport.js#L61-L66) |

All 16 known server events are forwarded through `onMessage(event, data)`
([SocketIOClientTransport.js:4-19](https://github.com/s1ryx/skipbo/blob/760826fa15e14d031bccbcd18d89a48139873ed2/client/src/transport/SocketIOClientTransport.js#L4-L19)).

### How a Future Transport Would Slot In

No coordinator or game logic changes needed — only new adapter files:
- **Server**: e.g. `SSETransport.js` — `GET /events?playerId=X` for SSE
  stream, `POST /action` for client messages, in-memory group membership
- **Client**: e.g. `SSEClientTransport.js` — `EventSource` for receiving,
  `fetch POST` for sending
- **Selection**: environment variable or config to choose which adapter to
  instantiate in `server.js` and `useGameConnection.js`

## Server Architecture

### Wiring

[`server.js`](https://github.com/s1ryx/skipbo/blob/75194bc0bf82641168040336e87a6736a786fc90/server/server.js)
(34 lines) is a thin entry point that creates the Express app, health
endpoint, and wires the coordinator to the transport
([server.js:23-28](https://github.com/s1ryx/skipbo/blob/75194bc0bf82641168040336e87a6736a786fc90/server/server.js#L23-L28)):

```js
const coordinator = new GameCoordinator();
const transport = new SocketIOTransport(coordinator.getTransportHandlers());
coordinator.setTransport(transport);
transport.attach(server);
```

### Game Coordinator

[`GameCoordinator`](https://github.com/s1ryx/skipbo/blob/c1bb7749352cea4e9d335eb7c5e8f568e45b2373/server/gameCoordinator.js)
owns all game coordination state and handler logic. It receives events from
the transport through `handleMessage()` and calls `this.transport.send()`
/ `sendToGroup()` / etc. for outbound communication.

### Storage

Four in-memory maps hold all state
([gameCoordinator.js:29-32](https://github.com/s1ryx/skipbo/blob/8e88993/server/gameCoordinator.js#L29-L32)):

- **`games`** (`Map<roomId, SkipBoGame>`) — one game instance per room
- **`playerRooms`** (`Map<connectionId, roomId>`) — tracks which room each
  connected player belongs to
- **`pendingDeletions`** (`Map<roomId, timeoutId>`) — grace period timers
  for empty lobbies
- **`completedGameTimers`** (`Map<roomId, timeoutId>`) — cleanup timers
  for completed games

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

### Coordinator Helpers

- **`cancelPendingDeletion(roomId)`** — clears a grace period timer when a
  player joins before the timeout expires
  ([gameCoordinator.js:413-420](https://github.com/s1ryx/skipbo/blob/c1bb7749352cea4e9d335eb7c5e8f568e45b2373/server/gameCoordinator.js#L413-L420))
- **`scheduleRoomDeletion(roomId)`** — schedules room deletion after
  `LOBBY_GRACE_PERIOD_MS` (30s), with a cap of `MAX_PENDING_ROOMS` (50)
  to prevent abuse
  ([gameCoordinator.js:396-411](https://github.com/s1ryx/skipbo/blob/c1bb7749352cea4e9d335eb7c5e8f568e45b2373/server/gameCoordinator.js#L396-L411))
- **`generateRoomId()`** — creates a 6-character room code using
  easily-distinguishable characters
  ([gameCoordinator.js:424-433](https://github.com/s1ryx/skipbo/blob/c1bb7749352cea4e9d335eb7c5e8f568e45b2373/server/gameCoordinator.js#L424-L433))

### HTTP Endpoint

A single REST endpoint exists for health checks
([server.js:15-21](https://github.com/s1ryx/skipbo/blob/75194bc0bf82641168040336e87a6736a786fc90/server/server.js#L15-L21)):

```
GET /health → { status: "ok", version, timestamp }
```

## Client Architecture

### Component Tree

```
index.js
└─ <StrictMode>
   └─ <LanguageProvider>          ← i18n context
      └─ <App>                    ← routing, URL params
         │  └─ useGameConnection()
         │     └─ SocketIOClientTransport
         │        (connect / send / disconnect)
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

All server-related state lives in the `useGameConnection` custom hook
([useGameConnection.js:20-46](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L20-L46)):

| State          | Type    | Purpose                                  |
| -------------- | ------- | ---------------------------------------- |
| `gameState`    | object  | Public game state from server            |
| `playerState`  | object  | Private player state (hand, stockpile)   |
| `playerId`     | string  | Current connection ID                    |
| `roomId`       | string  | Current room code                        |
| `inLobby`      | boolean | Controls Lobby vs game rendering         |
| `error`        | string  | Temporary error message (auto-clears)    |
| `chatMessages` | array   | Chat history (persisted to sessionStorage) |
| `stablePlayerId` | string | Persistent ID for chat attribution     |

App-level state in `App.js`
([App.js:14](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/App.js#L14)):

| State            | Type   | Purpose                                   |
| ---------------- | ------ | ----------------------------------------- |
| `roomIdFromUrl`  | string | Room ID extracted from `?room=` URL param |

The hook returns state and action functions. Components never manage
server-related state themselves — they receive data and call callbacks.

### Component Responsibilities

**`App`** ([App.js](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/App.js), 100 lines)

- Thin rendering shell that routes between Lobby, WaitingRoom, and GameBoard
- Extracts `?room=` URL parameter on mount
  ([App.js:16-23](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/App.js#L16-L23))
- Calls `useGameConnection()` for all server interaction
  ([App.js:25-43](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/App.js#L25-L43))
- Three-way routing: `inLobby` → Lobby, `!gameStarted` → WaitingRoom,
  else → GameBoard
  ([App.js:53-77](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/App.js#L53-L77))

**`useGameConnection`** ([useGameConnection.js](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js), 314 lines)

- Creates a `SocketIOClientTransport` and connects on mount
  ([useGameConnection.js:204-233](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L204-L233))
- Defines 14 message handlers for server events
  ([useGameConnection.js:55-202](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L55-L202))
- Defines 9 action functions that send events through the transport
  ([useGameConnection.js:238-291](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L238-L291))
- Uses `connectionIdRef` and `roomIdRef` to avoid stale closures in callbacks
  ([useGameConnection.js:44-45](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L44-L45))
- Generates and persists a stable player ID for chat attribution
  ([useGameConnection.js:5-17](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L5-L17))
- Chat message persistence to sessionStorage
  ([useGameConnection.js:48-52](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L48-L52))

**`Lobby`** ([Lobby.js](https://github.com/s1ryx/skipbo/blob/d54aea5240e8a572c0892118406bdb2034913988/client/src/components/Lobby.js))

- Two-form UI: create room or join existing room
- Local state: player name, max players, stockpile size, room ID input
- Calls `onCreateRoom(name, maxPlayers, stockpileSize)` or
  `onJoinRoom(roomId, name)` — both passed from `App`
- Enforces stockpile size limits based on player count
  ([Lobby.js:12-14](https://github.com/s1ryx/skipbo/blob/d54aea5240e8a572c0892118406bdb2034913988/client/src/components/Lobby.js#L12-L14))

**`WaitingRoom`** ([WaitingRoom.js](https://github.com/s1ryx/skipbo/blob/20466d1f7a5327147ad8b48f12ccd5201322b9f1/client/src/components/WaitingRoom.js), 74 lines)

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
- Uses `stablePlayerId` (not connection ID) to identify own messages,
  so authorship survives reconnections
  ([Chat.js:50-53](https://github.com/s1ryx/skipbo/blob/5290fba7a55afb2e295f4d897c6b8a39526fcf71/client/src/components/Chat.js#L50-L53))
- Messages persist to sessionStorage per room

### Session Persistence

The hook saves session data to sessionStorage on room creation, join,
and reconnection (inline in each message handler, e.g.
[useGameConnection.js:53-58](https://github.com/s1ryx/skipbo/blob/07b5e4f/client/src/useGameConnection.js#L53-L58)):

```json
skipBoSession: { "roomId": "ABC123", "playerId": "connection-id", "playerName": "Alice", "sessionToken": "..." }
```

On page reload, the `onConnect` handler checks for a saved session and
sends `reconnect` to rejoin the room
([useGameConnection.js:211-223](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L211-L223)).
The server updates the player's connection ID to the new one
([gameCoordinator.js:157-161](https://github.com/s1ryx/skipbo/blob/c1bb7749352cea4e9d335eb7c5e8f568e45b2373/server/gameCoordinator.js#L157-L161)).

Session data is cleared on game over
([useGameConnection.js:145-158](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L145-L158))
and game abort
([useGameConnection.js:172-192](https://github.com/s1ryx/skipbo/blob/104d152ff4a27aef9afdafe7f103e29ed9395b3b/client/src/useGameConnection.js#L172-L192)).

## Event Reference

### Client → Server (emitted by client)

| Event                   | Payload                                     | Emitted from                                                                                                                                    | Handler                                                                                                                            |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `createRoom`            | `{ playerName, maxPlayers, stockpileSize }` | [useGameConnection.js:239](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L239)                                 | [gameCoordinator.js:57](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L57)                              |
| `joinRoom`              | `{ roomId, playerName }`                    | [useGameConnection.js:243](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L243)                                 | [gameCoordinator.js:76](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L76)                              |
| `reconnect`             | `{ roomId, sessionToken, playerName }`      | [useGameConnection.js:249](https://github.com/s1ryx/skipbo/blob/5a77985/client/src/useGameConnection.js#L249)                                  | [gameCoordinator.js:57](https://github.com/s1ryx/skipbo/blob/5a77985/server/gameCoordinator.js#L57)                               |
| `startGame`             | _(none)_                                    | [useGameConnection.js:250](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L250)                                 | [gameCoordinator.js:180](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L180)                            |
| `playCard`              | `{ card, source, buildingPileIndex }`       | [useGameConnection.js:254](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L254)                                 | [gameCoordinator.js:206](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L206)                            |
| `discardCard`           | `{ card, discardPileIndex }`                | [useGameConnection.js:258](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L258)                                 | [gameCoordinator.js:237](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L237)                            |
| `sendChatMessage`       | `{ message }`                               | [useGameConnection.js:278](https://github.com/s1ryx/skipbo/blob/00bbf87/client/src/useGameConnection.js#L278)                                  | [gameCoordinator.js:65](https://github.com/s1ryx/skipbo/blob/00bbf87/server/gameCoordinator.js#L65)                               |
| `leaveLobby`            | _(none)_                                    | [useGameConnection.js:266](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L266)                                 | [gameCoordinator.js:321](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L321)                            |
| `leaveGame`             | _(none)_                                    | [useGameConnection.js:279](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L279)                                 | [gameCoordinator.js:344](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L344)                            |
| `requestRematch`        | _(none)_                                    | [useGameConnection.js:299](https://github.com/s1ryx/skipbo/blob/21bf634/client/src/useGameConnection.js#L299)                                  | [gameCoordinator.js:75](https://github.com/s1ryx/skipbo/blob/6f973d2/server/gameCoordinator.js#L75)                               |
| `updateRematchSettings` | `{ stockpileSize }`                         | [useGameConnection.js:303](https://github.com/s1ryx/skipbo/blob/21bf634/client/src/useGameConnection.js#L303)                                  | [gameCoordinator.js:77](https://github.com/s1ryx/skipbo/blob/6f973d2/server/gameCoordinator.js#L77)                               |

### Server → Client (emitted by server)

| Event                | Payload                                                        | Emitted from                                                                                                                        | Listener                                                                                                                            |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `roomCreated`        | `{ roomId, playerId, sessionToken, gameState }`                | [gameCoordinator.js:111](https://github.com/s1ryx/skipbo/blob/5a77985/server/gameCoordinator.js#L111)                              | [useGameConnection.js:43](https://github.com/s1ryx/skipbo/blob/21bf634/client/src/useGameConnection.js#L43)                        |
| `playerJoined`       | `{ playerId, playerName, gameState }`                          | [gameCoordinator.js:101](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L101)                             | [useGameConnection.js:74](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L74)                       |
| `sessionToken`       | `{ playerId, sessionToken }`                                   | [gameCoordinator.js:161](https://github.com/s1ryx/skipbo/blob/5a77985/server/gameCoordinator.js#L161)                              | [useGameConnection.js:68](https://github.com/s1ryx/skipbo/blob/21bf634/client/src/useGameConnection.js#L68)                        |
| `playerLeft`         | `{ playerId, gameState }`                                      | [gameCoordinator.js:337](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L337)                             | [useGameConnection.js:95](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L95)                       |
| `reconnected`        | `{ roomId, playerId, sessionToken, gameState, playerState }`   | [gameCoordinator.js:210](https://github.com/s1ryx/skipbo/blob/5a77985/server/gameCoordinator.js#L210)                              | [useGameConnection.js:98](https://github.com/s1ryx/skipbo/blob/21bf634/client/src/useGameConnection.js#L98)                        |
| `reconnectFailed`    | `{ message }`                                                  | [gameCoordinator.js:169](https://github.com/s1ryx/skipbo/blob/5a77985/server/gameCoordinator.js#L169)                              | [useGameConnection.js:120](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L120)                     |
| `playerReconnected`  | `{ playerId, playerName }`                                     | [gameCoordinator.js:172](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L172)                             | [useGameConnection.js:173](https://github.com/s1ryx/skipbo/blob/b2441d0/client/src/useGameConnection.js#L173)                      |
| `gameStarted`        | `{ gameState, playerState }`                                   | [gameCoordinator.js:197](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L197)                             | [useGameConnection.js:128](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L128)                     |
| `gameStateUpdate`    | `{ gameState, playerState }`                                   | [gameCoordinator.js:223](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L223)                             | [useGameConnection.js:135](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L135)                     |
| `turnChanged`        | `{ currentPlayerId }`                                          | [gameCoordinator.js:267](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L267)                             | _(state derived from gameStateUpdate)_                                                                                              |
| `gameOver`           | `{ winner, gameState }`                                        | [gameCoordinator.js:230](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L230)                             | [useGameConnection.js:145](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L145)                     |
| `playerDisconnected` | `{ playerId }`                                                 | [gameCoordinator.js:388](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L388)                             | [useGameConnection.js:160](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L160)                     |
| `gameAborted`        | _(none)_                                                       | [gameCoordinator.js:353](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L353)                             | [useGameConnection.js:172](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L172)                     |
| `rematchVoteUpdate`  | `{ rematchVotes, stockpileSize }`                              | [gameCoordinator.js:493](https://github.com/s1ryx/skipbo/blob/6f973d2/server/gameCoordinator.js#L493)                              | [useGameConnection.js:207](https://github.com/s1ryx/skipbo/blob/21bf634/client/src/useGameConnection.js#L207)                      |
| `playerLeftPostGame` | `{ gameState }`                                                | [gameCoordinator.js:447](https://github.com/s1ryx/skipbo/blob/6f973d2/server/gameCoordinator.js#L447)                              | [useGameConnection.js:212](https://github.com/s1ryx/skipbo/blob/21bf634/client/src/useGameConnection.js#L212)                      |
| `chatMessage`        | `{ playerId, playerName, stablePlayerId, message, timestamp }` | [gameCoordinator.js:310](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L310)                             | [useGameConnection.js:194](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L194)                     |
| `error`              | `{ message }`                                                  | [various](https://github.com/s1ryx/skipbo/blob/c1bb7749/server/gameCoordinator.js#L80)                                             | [useGameConnection.js:198](https://github.com/s1ryx/skipbo/blob/104d152f/client/src/useGameConnection.js#L198)                     |

## Game Flow

### 1. Room Creation

```
Player A opens app
  → App mounts, useGameConnection creates transport  (useGameConnection.js:204-232)
  → Player fills out lobby form                      (Lobby.js)
  → Lobby calls onCreateRoom(name, max, size)        (useGameConnection.js:238-240)
  → Client sends 'createRoom' via transport          (useGameConnection.js:239)
  → Server creates SkipBoGame instance               (gameCoordinator.js:59)
  → Server stores in games Map                       (gameCoordinator.js:62)
  → Server sends 'roomCreated' to creator            (gameCoordinator.js:67-71)
  → Hook sets roomId, gameState, inLobby=false       (useGameConnection.js:56-71)
  → App renders WaitingRoom                          (App.js:55-62)
```

### 2. Joining a Room

```
Player B opens app, enters room code
  → Lobby calls onJoinRoom(roomId, name)             (useGameConnection.js:242-247)
  → Client sends 'joinRoom' via transport            (useGameConnection.js:243)
  → Server validates room exists, not full           (gameCoordinator.js:79-96)
  → Server adds player to SkipBoGame                 (gameCoordinator.js:91)
  → Server sends 'playerJoined' to ALL in room       (gameCoordinator.js:101-105)
  → Both clients update gameState                    (useGameConnection.js:74-93)
  → Player list updates in WaitingRoom
```

### 3. Starting the Game

```
Any player clicks "Start Game"
  → WaitingRoom calls onStartGame                    (WaitingRoom.js)
  → Client sends 'startGame' via transport           (useGameConnection.js:250)
  → Server calls game.startGame()                    (gameCoordinator.js:189)
    → Deck created and shuffled                      (gameLogic.js:61)
    → Stockpiles dealt (20-30 cards each)            (gameLogic.js:71-75)
    → Hands dealt (5 cards each)                     (gameLogic.js:78-80)
  → Server sends 'gameStarted' to EACH player       (gameCoordinator.js:196-201)
    (each gets their own playerState)
  → App routing switches to GameBoard                (App.js:63-77)
```

### 4. Playing a Card

```
Player clicks a card source (hand/stockpile/discard top)
  → handleCardSelect stores card + source            (GameBoard.js:44-53)
  → UI highlights the selected card

Player clicks a building pile
  → handleBuildingPileClick fires                    (GameBoard.js:55-62)
  → Client sends 'playCard' via transport            (useGameConnection.js:254)
  → Server calls game.playCard()                     (gameCoordinator.js:215)
    → Validates: correct turn, valid move            (gameLogic.js:136-145)
    → Removes card from source                       (gameLogic.js:148-167)
    → Adds card to building pile                     (gameLogic.js:174)
    → If pile reaches 12: recycle into deck          (gameLogic.js:182-190)
    → If hand empty: auto-draw 5 cards               (gameLogic.js:193-195)
    → If stockpile empty: player wins                (gameLogic.js:198-201)
  → Server sends 'gameStateUpdate' to each           (gameCoordinator.js:222-227)
  → If game over: server sends 'gameOver'            (gameCoordinator.js:229-234)
```

### 5. Discarding and Ending a Turn

```
Player clicks "End Turn (Discard a Card)"
  → handleEndTurn sets discardMode=true              (GameBoard.js:86-90)
  → UI highlights discard piles as targets

Player clicks a discard pile
  → handleDiscardPileClick fires                     (GameBoard.js:64-78)
  → Client sends 'discardCard' via transport         (useGameConnection.js:258)
  → Server calls game.discardCard()                  (gameCoordinator.js:246)
    → Removes card from hand                         (gameLogic.js:217-224)
    → Adds to chosen discard pile                    (gameLogic.js:224)
  → Server calls game.endTurn()                      (gameCoordinator.js:253)
    → Advances currentPlayerIndex                    (gameLogic.js:252)
    → Draws cards for next player                    (gameLogic.js:255-256)
  → Server sends 'gameStateUpdate' + 'turnChanged'  (gameCoordinator.js:260-269)
```

### 6. Chat

```
Player types message and submits
  → Chat calls onSendMessage(text)                   (Chat.js:34-39)
  → Hook sends 'sendChatMessage' via transport       (useGameConnection.js:284)
  → Server broadcasts 'chatMessage' to room          (gameCoordinator.js:310-316)
  → All clients append to chatMessages               (useGameConnection.js:194-196)
  → Messages saved to sessionStorage per room         (useGameConnection.js:48-52)
```

### 7. Reconnection

```
Player reloads page
  → App mounts, useGameConnection creates transport  (useGameConnection.js:204-232)
  → On connect, checks sessionStorage                 (useGameConnection.js:211-223)
  → If session found, sends 'reconnect'              (useGameConnection.js:217)
  → Server finds player by old ID                    (gameCoordinator.js:122)
  → Server swaps old connection ID for new           (gameCoordinator.js:157-161)
  → Server sends 'reconnected' with full state       (gameCoordinator.js:165-170)
  → Hook restores game state                         (useGameConnection.js:101-118)
```

### 8. Leaving / Disconnect

```
Player clicks "Leave Game" in waiting room
  → Client sends 'leaveLobby' via transport          (useGameConnection.js:266)
  → Server removes player from room                  (gameCoordinator.js:330-332)
  → If empty: schedules deletion after grace period  (gameCoordinator.js:334-335)
  → If others remain: sends 'playerLeft'             (gameCoordinator.js:337-340)

Player clicks "Leave Game" during active game
  → Client sends 'leaveGame' via transport           (useGameConnection.js:279)
  → Server sends 'gameAborted' to entire room        (gameCoordinator.js:353)
  → Server deletes game from Map                     (gameCoordinator.js:360)
  → All clients return to lobby                      (useGameConnection.js:172-192)

Player disconnects (tab close, network loss)
  → Server 'disconnect' handler fires                (gameCoordinator.js:365)
  → If pre-game: removes player, may schedule deletion (gameCoordinator.js:377-386)
  → If mid-game: sends 'playerDisconnected'          (gameCoordinator.js:388-390)
    → Room persists for reconnection
```

## Data Flow Diagram

```
                   Props (↓)              Callbacks (↑)
                ┌─────────────────────────────────────────┐
                │               App.js                     │
                │  useGameConnection() → state + actions   │
                │  roomIdFromUrl                           │
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

## Browser Storage Keys

**sessionStorage** (cleared when tab closes):

| Key                   | Value                                              | Used by                                                                                                                                         |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `skipBoSession`       | `{ roomId, playerId, playerName, sessionToken }`   | Reconnection on reload ([useGameConnection.js:12](https://github.com/s1ryx/skipbo/blob/07b5e4f/client/src/useGameConnection.js#L12))            |
| `skipBoChat_{roomId}` | `[{ message, playerName, ... }]`                   | Chat persistence ([useGameConnection.js:16](https://github.com/s1ryx/skipbo/blob/07b5e4f/client/src/useGameConnection.js#L16))                  |

**localStorage** (persists across sessions):

| Key                  | Value                 | Used by                                                                                                                                         |
| -------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `skipBoPlayerName`   | `"Alice"`             | Remember player name ([Lobby.js:8](https://github.com/s1ryx/skipbo/blob/40293c1/client/src/components/Lobby.js#L8))                             |
| `skipBoLanguage`     | `"en"`, `"de"`, `"tr"` | Language preference ([LanguageContext.js:13](https://github.com/s1ryx/skipbo/blob/4c5a736/client/src/i18n/LanguageContext.js#L13))               |
| `skipBoQuickDiscard` | `"true"` or `"false"` | Quick discard setting ([GameBoard.js:26](https://github.com/s1ryx/skipbo/blob/6759b999e35f1d2875968390247574b0c3f1a163/client/src/components/GameBoard.js#L26)) |
