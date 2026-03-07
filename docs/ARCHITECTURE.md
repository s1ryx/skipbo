# Architecture & Program Flow

> Part of the [project documentation](../README.md#documentation).
> See also: [Technical Debt](TECH_DEBT.md) for known coupling issues,
> [Design Principles](DESIGN_PRINCIPLES.md) for the target architecture.

This document describes how the client and server interact, how data flows
through the system, and how the React component tree is structured.

## High-Level Overview

The application is a real-time multiplayer card game with two processes:

- **Server** — Node.js + Express + Socket.IO
  ([server/server.js](https://github.com/s1ryx/skipbo/blob/f7179e8d/server/server.js))
- **Client** — React single-page app
  ([client/src/App.js](https://github.com/s1ryx/skipbo/blob/1ad65ca/client/src/App.js))

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
│  │   ├─ messageHandlers│              │  │  ├─ gameLogic.js       │
│  │   └─ SocketIO-     │               │  │  │  (SkipBoGame)       │
│  │     ClientTransport│               │  │  ├─ SessionManager.js  │
│  ├─ Lobby             │               │  │  ├─ BotManager.js      │
│  ├─ WaitingRoom       │               │  │  └─ GameRepository.js  │
│  └─ GameBoard         │               │  ├─ config.js             │
│     ├─ OpponentArea   │               │  ├─ errors.js             │
│     ├─ BuildingPiles  │               │  ├─ logger.js             │
│     ├─ PlayerArea     │               │  └─ transport/            │
│     │  └─ PlayerHand  │               │     └─ SocketIOTransport  │
│     │     └─ Card     │               │                           │
│     ├─ GameOverOverlay│               │  ai/                      │
│     └─ Chat           │               │  ├─ AIPlayer.js           │
│                       │               │  └─ baseline/AIPlayer.js  │
│  ErrorBoundary        │               │                           │
│  ConnectionStatus     │               │                           │
└──────────────────────┘                └──────────────────────────┘
```

## Transport Abstraction

Game logic and UI are fully decoupled from the wire protocol. Both server
and client communicate through transport adapters that expose a small,
generic interface. Swapping Socket.IO for a different transport (e.g.,
SSE + REST) requires only writing a new adapter — no changes to the
game coordinator or React components.

### Server Transport Interface

[`SocketIOTransport`](https://github.com/s1ryx/skipbo/blob/e757e5c4/server/transport/SocketIOTransport.js)
implements:

| Method                                               | Socket.IO equivalent                 | Line                                                                                                 |
| ---------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `send(connectionId, event, data)`                    | `io.to(socketId).emit(event, data)`  | [66-68](https://github.com/s1ryx/skipbo/blob/9accfc10/server/transport/SocketIOTransport.js#L66-L68) |
| `sendToGroup(groupId, event, data)`                  | `io.to(roomId).emit(event, data)`    | [71-73](https://github.com/s1ryx/skipbo/blob/9accfc10/server/transport/SocketIOTransport.js#L71-L73) |
| `sendToGroupExcept(groupId, excludeId, event, data)` | `io.to(roomId).except(id).emit(...)` | [76-78](https://github.com/s1ryx/skipbo/blob/9accfc10/server/transport/SocketIOTransport.js#L76-L78) |
| `addToGroup(connectionId, groupId)`                  | `socket.join(roomId)`                | [81-86](https://github.com/s1ryx/skipbo/blob/9accfc10/server/transport/SocketIOTransport.js#L81-L86) |
| `removeFromGroup(connectionId, groupId)`             | `socket.leave(roomId)`               | [89-94](https://github.com/s1ryx/skipbo/blob/9accfc10/server/transport/SocketIOTransport.js#L89-L94) |

The adapter accepts three handler callbacks on construction
([SocketIOTransport.js:28-33](https://github.com/s1ryx/skipbo/blob/a50b4ca3/server/transport/SocketIOTransport.js#L28-L33)):
`onConnect(connectionId)`, `onDisconnect(connectionId)`,
`onMessage(connectionId, event, data)`.

All 13 known client events are forwarded through the single `onMessage`
dispatcher
([CLIENT_EVENTS:5-19](https://github.com/s1ryx/skipbo/blob/895cfa34/server/transport/SocketIOTransport.js#L5-L19)).
Rate limiting is applied per connection.

### Client Transport Interface

[`SocketIOClientTransport`](https://github.com/s1ryx/skipbo/blob/68c9542b/client/src/transport/SocketIOClientTransport.js)
implements:

| Method              | Socket.IO equivalent       | Line                                                                                                           |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `connect()`         | `io(url)`                  | [36-53](https://github.com/s1ryx/skipbo/blob/625289d5/client/src/transport/SocketIOClientTransport.js#L36-L53) |
| `send(event, data)` | `socket.emit(event, data)` | [56-60](https://github.com/s1ryx/skipbo/blob/625289d5/client/src/transport/SocketIOClientTransport.js#L56-L60) |
| `disconnect()`      | `socket.close()`           | [63-68](https://github.com/s1ryx/skipbo/blob/625289d5/client/src/transport/SocketIOClientTransport.js#L63-L68) |

All 16 known server events are forwarded through `onMessage(event, data)`
([SERVER_EVENTS:4-21](https://github.com/s1ryx/skipbo/blob/68c9542b/client/src/transport/SocketIOClientTransport.js#L4-L21)).

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

[`server.js`](https://github.com/s1ryx/skipbo/blob/f7179e8d/server/server.js)
(~14 lines) is a thin entry point that starts the server.
[`createServer.js`](https://github.com/s1ryx/skipbo/blob/09ab60eb/server/createServer.js)
(~37 lines) creates the Express app, health endpoint, and wires the
coordinator to the transport
([createServer.js:22-31](https://github.com/s1ryx/skipbo/blob/09ab60eb/server/createServer.js#L22-L31)):

```js
const coordinator = new GameCoordinator({ logger });
const transport = new SocketIOTransport(coordinator.getTransportHandlers());
coordinator.setTransport(transport);
transport.attach(server);
```

### Module Overview

| Module                                                                                          | Lines | Responsibility                              |
| ----------------------------------------------------------------------------------------------- | ----- | ------------------------------------------- |
| [`gameCoordinator.js`](https://github.com/s1ryx/skipbo/blob/1a2880a/server/gameCoordinator.js) | ~1114 | Event handling, orchestration, broadcasting |
| [`gameLogic.js`](https://github.com/s1ryx/skipbo/blob/75c49393/server/gameLogic.js)             | ~437  | Game rules engine (SkipBoGame class)        |
| [`config.js`](https://github.com/s1ryx/skipbo/blob/1a2880a/server/config.js)                    | ~68   | Constants, Phase enum, BOT_ID_PREFIX        |
| [`errors.js`](https://github.com/s1ryx/skipbo/blob/833f1737/server/errors.js)                   | ~42   | GameError class and ErrorCodes              |
| [`logger.js`](https://github.com/s1ryx/skipbo/blob/c1a03c5/server/logger.js)                    | ~30   | Structured JSON logger factory              |
| [`SessionManager.js`](https://github.com/s1ryx/skipbo/blob/2af34157/server/SessionManager.js)   | ~44   | Connection-to-room mapping                  |
| [`BotManager.js`](https://github.com/s1ryx/skipbo/blob/5074075/server/BotManager.js)            | ~75   | Bot AI instances, timer scheduling          |
| [`GameRepository.js`](https://github.com/s1ryx/skipbo/blob/6873a30c/server/GameRepository.js)   | ~70   | Game storage, cleanup timers                |

### Game Coordinator

[`GameCoordinator`](https://github.com/s1ryx/skipbo/blob/1a2880a/server/gameCoordinator.js)
owns all game coordination logic. It receives events from the transport
through [`handleMessage()`](https://github.com/s1ryx/skipbo/blob/50a590e7/server/gameCoordinator.js#L89-L120)
and calls `this.transport.send()` / `sendToGroup()` / etc. for outbound
communication. It delegates to:

- `SessionManager` — connection-to-room lookups
- `GameRepository` — game storage and cleanup timer scheduling
- `BotManager` — bot AI instances and turn timer scheduling
- `SkipBoGame` — all game rules and state

### Storage

Game state is managed through [`GameRepository`](https://github.com/s1ryx/skipbo/blob/6873a30c/server/GameRepository.js),
which wraps an in-memory Map and owns cleanup timers:

- [**`getGame(roomId)`**](https://github.com/s1ryx/skipbo/blob/d5378640/server/GameRepository.js#L8-L10) — retrieves a `SkipBoGame` instance
- [**`saveGame(roomId, game)`**](https://github.com/s1ryx/skipbo/blob/d5378640/server/GameRepository.js#L12-L14) — stores a game instance
- [**`deleteGame(roomId)`**](https://github.com/s1ryx/skipbo/blob/d5378640/server/GameRepository.js#L16-L18) — removes a game and clears its timers
- [**`scheduleDeletion(roomId, delay)`**](https://github.com/s1ryx/skipbo/blob/6873a30c/server/GameRepository.js#L32-L38) — grace period for empty lobbies
- [**`scheduleCompletedCleanup(roomId, delay)`**](https://github.com/s1ryx/skipbo/blob/6873a30c/server/GameRepository.js#L50-L56) — TTL for finished games

Connection-to-room mapping is managed by [`SessionManager`](https://github.com/s1ryx/skipbo/blob/2af34157/server/SessionManager.js):

- [**`getRoom(connectionId)`**](https://github.com/s1ryx/skipbo/blob/935d0b33/server/SessionManager.js#L12-L14) — which room a connection belongs to
- [**`setRoom(connectionId, roomId)`**](https://github.com/s1ryx/skipbo/blob/935d0b33/server/SessionManager.js#L16-L18) — register a connection
- [**`removeRoom(connectionId)`**](https://github.com/s1ryx/skipbo/blob/935d0b33/server/SessionManager.js#L20-L22) — unregister on disconnect
- [**`transferConnection(oldId, newId)`**](https://github.com/s1ryx/skipbo/blob/935d0b33/server/SessionManager.js#L28-L34) — reconnection ID swap

### Game Logic

[`SkipBoGame`](https://github.com/s1ryx/skipbo/blob/75c49393/server/gameLogic.js)
is a plain class that encapsulates all game rules:

- **Deck** — 144 cards from [`createDeck()`](https://github.com/s1ryx/skipbo/blob/e757e5c4/server/gameLogic.js#L49-L60):
  12 copies each of 1–12, plus 18 SKIP-BO wilds
- **Player model** — [`{ internalId, connectionId, publicId, name,
stockpile[], hand[], discardPiles[4][] }`](https://github.com/s1ryx/skipbo/blob/d6a72f73/server/gameLogic.js#L70-L87)
- **Phase** — [`this.phase`](https://github.com/s1ryx/skipbo/blob/2e7e0d9e/server/gameLogic.js#L37) tracks `LOBBY` → `PLAYING` → `FINISHED`
  (backward-compatible `gameStarted`/`gameOver` getters provided)
- **Building piles** — 4 shared piles that count 1→12, [cleared when
  complete](https://github.com/s1ryx/skipbo/blob/e757e5c4/server/gameLogic.js#L274-L282)
  and recycled into the deck
- **Turn flow** — [`endTurn()`](https://github.com/s1ryx/skipbo/blob/75c49393/server/gameLogic.js#L338-L353)
  advances `currentPlayerIndex` and draws cards for the next player
- **Win condition** — a player's [stockpile reaches length 0](https://github.com/s1ryx/skipbo/blob/2e7e0d9e/server/gameLogic.js#L289-L292)
- **Rematch** — [`addRematchVote()`](https://github.com/s1ryx/skipbo/blob/d580802c/server/gameLogic.js#L355-L359),
  [`removeRematchVote()`](https://github.com/s1ryx/skipbo/blob/d580802c/server/gameLogic.js#L361-L363),
  [`clearRematchVotes()`](https://github.com/s1ryx/skipbo/blob/d580802c/server/gameLogic.js#L365-L367),
  [`canStartRematch()`](https://github.com/s1ryx/skipbo/blob/d580802c/server/gameLogic.js#L369-L371)
- **Player mutators** — [`updateConnectionId()`](https://github.com/s1ryx/skipbo/blob/37ceeb5a/server/gameLogic.js#L107-L112),
  [`setSessionToken()`](https://github.com/s1ryx/skipbo/blob/cf76c4b9/server/gameLogic.js#L114-L119),
  [`setHost()`](https://github.com/s1ryx/skipbo/blob/dd6ec8a9/server/gameLogic.js#L121-L123)

### Two views of game state

The server exposes two projection methods to avoid leaking private data:

- [**`getGameState()`**](https://github.com/s1ryx/skipbo/blob/d580802c/server/gameLogic.js#L396-L420) — public state visible to all players: player
  names, stockpile counts/tops, hand counts, discard piles (visible),
  building piles, current turn, game phase. Bot metadata (`isBot`,
  `aiType`) is decorated by the coordinator before broadcasting.
- [**`getPlayerState(playerId)`**](https://github.com/s1ryx/skipbo/blob/cf76c4b9/server/gameLogic.js#L422-L433) — private state for one player: full hand
  contents, full stockpile contents

Every state update sends both to the relevant player so opponents never see
each other's hands.

### Unified Turn Execution

Both human event handlers and the bot turn driver use shared methods:

- [**`_executePlay(roomId, game, playerId, card, source, pileIndex)`**](https://github.com/s1ryx/skipbo/blob/2af34157/server/gameCoordinator.js#L868-L905) —
  calls `game.playCard()`, checks game-over, broadcasts state
- [**`_executeDiscard(roomId, game, playerId, card, pileIndex)`**](https://github.com/s1ryx/skipbo/blob/2af34157/server/gameCoordinator.js#L907-L958) —
  calls `game.discardCard()`, ends turn, broadcasts state, schedules
  next bot turn if applicable

### Error Handling

[`GameError`](https://github.com/s1ryx/skipbo/blob/833f1737/server/errors.js#L1-L6)
([`ErrorCodes`](https://github.com/s1ryx/skipbo/blob/833f1737/server/errors.js#L8-L39))
provides typed error codes:

```js
const error = new GameError(ErrorCodes.ROOM_NOT_FOUND, 'Room does not exist');
```

The coordinator sends typed errors to clients:

```js
this.transport.send(id, 'error', { code: error.code, message: error.message });
```

Error codes are i18n-compatible (e.g. `error.roomNotFound`).

### HTTP Endpoint

A single REST endpoint exists for health checks:

```
GET /health → { status: "ok", version, timestamp }
```

## Client Architecture

### Component Tree

```
index.js
└─ <StrictMode>
   └─ <ErrorBoundary>               ← catches render errors
      └─ <LanguageProvider>          ← i18n context
         └─ <App>                    ← routing, URL params
            │  └─ useGameConnection()
            │     ├─ messageHandlers  (pure handler functions)
            │     └─ SocketIOClientTransport
            │        (connect / send / disconnect)
            │
            ├─ <ConnectionStatus>    ← connection indicator
            │
            ├─ <Lobby>               ← room creation/joining forms
            │   (when inLobby=true)
            │
            ├─ <WaitingRoom>         ← pre-game player list, bot management
            │   (when !inLobby && !gameStarted)
            │
            └─ <GameBoard>           ← active game UI (layout composition)
                (when !inLobby && gameStarted)
                ├─ <OptionsMenu>     ← gear dropdown (room code, settings, leave)
                ├─ <OpponentArea>    ← other players' visible state
                ├─ <BuildingPiles>   ← turn indicator + shared center piles
                ├─ <PlayerArea>      ← stockpile + hand (side by side), discard piles
                │  └─ <PlayerHand>   ← current player's hand cards
                │      └─ <Card>     ← individual card rendering
                ├─ actions bar       ← end turn, cancel discard
                ├─ <GameOverOverlay> ← winner display, rematch controls
                ├─ <LeaveConfirmDialog> ← confirmation modal
                └─ <Chat>            ← collapsible chat panel
```

### State Management

Server-related state lives in the [`useGameConnection`](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/useGameConnection.js)
custom hook (180 lines,
[state declarations:6-35](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/useGameConnection.js#L6-L35)):

| State                  | Type    | Purpose                                    |
| ---------------------- | ------- | ------------------------------------------ |
| `gameState`            | object  | Public game state from server              |
| `playerState`          | object  | Private player state (hand, stockpile)     |
| `playerId`             | string  | Current connection ID                      |
| `roomId`               | string  | Current room code                          |
| `inLobby`              | boolean | Controls Lobby vs game rendering           |
| `error`                | string  | Temporary error message (auto-clears)      |
| `isConnected`          | boolean | Transport connection status                |
| `chatMessages`         | array   | Chat history (persisted to sessionStorage) |
| `rematchVotes`         | array   | Current rematch votes                      |
| `rematchStockpileSize` | number  | Rematch stockpile setting                  |

Message handlers are defined in [`messageHandlers.js`](https://github.com/s1ryx/skipbo/blob/aa958d98/client/src/messageHandlers.js)
(176 lines of pure functions). The hook calls
[`createMessageHandlers()`](https://github.com/s1ryx/skipbo/blob/aa958d98/client/src/messageHandlers.js#L1-L13)
with state setters and refs, receiving a handler map that the transport
dispatches to.

App-level state in [`App.js`](https://github.com/s1ryx/skipbo/blob/1ad65ca/client/src/App.js):

| State           | Type   | Purpose                                   |
| --------------- | ------ | ----------------------------------------- |
| `roomIdFromUrl` | string | Room ID extracted from `?room=` URL param |

The hook returns state and action functions. Components never manage
server-related state themselves — they receive data and call callbacks.

### Component Responsibilities

**`App`** ([App.js](https://github.com/s1ryx/skipbo/blob/1ad65ca/client/src/App.js), ~142 lines)

- Thin rendering shell that routes between Lobby, WaitingRoom, and GameBoard
- Extracts `?room=` URL parameter on mount
  ([App.js:18-43](https://github.com/s1ryx/skipbo/blob/1ad65ca/client/src/App.js#L18-L43))
- Calls `useGameConnection()` for all server interaction
  ([App.js:45-70](https://github.com/s1ryx/skipbo/blob/1ad65ca/client/src/App.js#L45-L70))
- Three-way routing: `inLobby` → Lobby, `!gameStarted` → WaitingRoom,
  else → GameBoard
- Hides the app header and footer when an active game is in progress,
  giving the game board the full viewport height

**`useGameConnection`** ([useGameConnection.js](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/useGameConnection.js), 180 lines)

- Creates a `SocketIOClientTransport` and connects on mount
  ([useGameConnection.js:43-87](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/useGameConnection.js#L43-L87))
- Wires message handlers from `messageHandlers.js`
- Defines 11 action functions that send events through the transport
  ([useGameConnection.js:89-152](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/useGameConnection.js#L89-L152)):
  `createRoom`, `joinRoom`, `startGame`, `playCard`, `discardCard`,
  `leaveLobby`, `leaveGame`, `requestRematch`, `updateRematchSettings`,
  `sendChatMessage`, `addBot`, `removeBot`
- Session persistence to localStorage, chat persistence to sessionStorage
  ([useGameConnection.js:37-41](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/useGameConnection.js#L37-L41))

**`messageHandlers.js`** ([messageHandlers.js](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/messageHandlers.js), 176 lines)

- Pure factory function [`createMessageHandlers()`](https://github.com/s1ryx/skipbo/blob/2f493bf/client/src/messageHandlers.js#L1-L13) — no hooks, no transport
- Handles all 16 server events via injected state setters
- Session persistence (localStorage read/write) for roomCreated,
  sessionToken, reconnected events
- Independently testable with mock setters

**`Lobby`** ([Lobby.js](https://github.com/s1ryx/skipbo/blob/77a11220/client/src/components/Lobby.js))

- Two-form UI: create room or join existing room
- Local state: player name, max players, stockpile size, room ID input
- Calls `onCreateRoom(name, maxPlayers, stockpileSize)` or
  `onJoinRoom(roomId, name)` — both passed from `App`
- Enforces stockpile size limits based on player count
  ([Lobby.js:43-45](https://github.com/s1ryx/skipbo/blob/fadd48da/client/src/components/Lobby.js#L43-L45))

**`WaitingRoom`** ([WaitingRoom.js](https://github.com/s1ryx/skipbo/blob/cf88fed/client/src/components/WaitingRoom.js), ~120 lines)

- Pre-game lobby view shown after room creation/join
- Displays room ID, shareable link with copy button, and player list
- Bot management: add/remove AI bots with type selection
- Shows "Start Game" button when 2+ players present
- Calls `onStartGame`, `onLeaveLobby`, `onAddBot`, `onRemoveBot`

**`GameBoard`** ([GameBoard.js](https://github.com/s1ryx/skipbo/blob/6006d61/client/src/components/GameBoard.js), 189 lines)

- Layout composition component (only rendered when game has started)
- Manages card selection state locally
  ([selectedCard, selectedSource, discardMode:28-34](https://github.com/s1ryx/skipbo/blob/f03e48d7/client/src/components/GameBoard.js#L28-L34))
- Card interaction flow:
  1. Click a card → [`handleCardSelect`](https://github.com/s1ryx/skipbo/blob/b786cb08/client/src/components/GameBoard.js#L50-L59)
  2. Click a building pile → [`handleBuildingPileClick`](https://github.com/s1ryx/skipbo/blob/b786cb08/client/src/components/GameBoard.js#L61-L68)
  3. Click "End Turn" → [enters discard mode](https://github.com/s1ryx/skipbo/blob/e42f1ee6/client/src/components/GameBoard.js#L92-L102)
  4. Click a discard pile → [`handleDiscardPileClick`](https://github.com/s1ryx/skipbo/blob/f03e48d7/client/src/components/GameBoard.js#L70-L84)
- Computes turn status text and passes it to BuildingPiles
  ([turnText:112-118](https://github.com/s1ryx/skipbo/blob/acbc9cc/client/src/components/GameBoard.js#L112-L118))
- Delegates rendering to sub-components:
  - [`OptionsMenu`](https://github.com/s1ryx/skipbo/blob/d11a166/client/src/components/OptionsMenu.js) (102 lines) — gear dropdown with room code, quick discard toggle, language selector, leave button
  - [`OpponentArea`](https://github.com/s1ryx/skipbo/blob/1b02ddbe/client/src/components/OpponentArea.js) (75 lines) — opponent info and visible state
  - [`BuildingPiles`](https://github.com/s1ryx/skipbo/blob/acbc9cc/client/src/components/BuildingPiles.js) (54 lines) — turn indicator + center piles with click handling
  - [`PlayerArea`](https://github.com/s1ryx/skipbo/blob/6ea856b/client/src/components/PlayerArea.js) (131 lines) — stockpile and hand (side by side), discard piles (below)
  - [`GameOverOverlay`](https://github.com/s1ryx/skipbo/blob/4c4174cb/client/src/components/GameOverOverlay.js) (81 lines) — winner display, rematch voting
  - [`LeaveConfirmDialog`](https://github.com/s1ryx/skipbo/blob/84a51994/client/src/components/LeaveConfirmDialog.js) (24 lines) — confirmation modal
- Quick discard setting persisted to localStorage
  ([GameBoard.js:31-34](https://github.com/s1ryx/skipbo/blob/f03e48d7/client/src/components/GameBoard.js#L31-L34))

**`PlayerHand`** ([PlayerHand.js](https://github.com/s1ryx/skipbo/blob/fcbff344/client/src/components/PlayerHand.js))

- Renders the current player's hand cards horizontally
- Each card is clickable when not disabled (not your turn)
- Passes card selection up via `onCardSelect`

**`Card`** ([Card.js](https://github.com/s1ryx/skipbo/blob/fcbff344/client/src/components/Card.js))

- Pure presentational component for a single card
- Color-coded by value range: blue (1–4), green (5–8), red (9–12),
  wild (SKIP-BO)
  ([Card.js:10-17](https://github.com/s1ryx/skipbo/blob/fc6d9be5/client/src/components/Card.js#L10-L17))
- Supports visible/hidden (card back) and normal/small sizes

**`Chat`** ([Chat.js](https://github.com/s1ryx/skipbo/blob/b9dd37ae/client/src/components/Chat.js))

- Collapsible panel that sits inside `GameBoard`
- Tracks unread message count with a badge
  ([Chat.js:57](https://github.com/s1ryx/skipbo/blob/68b4f5e/client/src/components/Chat.js#L57))
- Compares [`msg.stablePlayerId`](https://github.com/s1ryx/skipbo/blob/b9dd37ae/client/src/components/Chat.js#L52-L55)
  against the opaque `playerId` prop to identify own messages, so
  authorship survives reconnections
- Messages persist to sessionStorage per room

**`ErrorBoundary`** ([ErrorBoundary.js](https://github.com/s1ryx/skipbo/blob/123bc20f/client/src/components/ErrorBoundary.js))

- React error boundary wrapping the app
- Catches render errors and displays a fallback UI

**`ConnectionStatus`** ([ConnectionStatus.js](https://github.com/s1ryx/skipbo/blob/4c098fa1/client/src/components/ConnectionStatus.js))

- Shows connection state indicator (connected/disconnected)
- Hidden when connected, visible banner when disconnected

**`cardUtils.js`** ([cardUtils.js](https://github.com/s1ryx/skipbo/blob/3bd276c0/client/src/utils/cardUtils.js))

- [`getNextCardForPile(pile)`](https://github.com/s1ryx/skipbo/blob/3bd276c0/client/src/utils/cardUtils.js#L1-L18) — computes which card a building pile
  needs next (1 for empty, top+1 otherwise, resets after 12)
- Replaces duplicated logic that previously existed in GameBoard

### Session Persistence

The message handlers save session data to localStorage on room creation,
join, and reconnection. Using localStorage ensures the session survives
tab closures and browser restarts:

```json
skipBoSession: { "roomId": "ABC123", "playerId": "connection-id", "playerName": "Alice", "sessionToken": "..." }
```

On page reload, the `onConnect` handler checks for a saved session and
sends `reconnect` to rejoin the room. The server updates the player's
connection ID to the new one via
[`game.updateConnectionId()`](https://github.com/s1ryx/skipbo/blob/37ceeb5a/server/gameLogic.js#L107-L112).

Session data is cleared on game over and game abort.

## Event Reference

### Client → Server (emitted by client)

| Event                   | Payload                                     | Handler                       |
| ----------------------- | ------------------------------------------- | ----------------------------- |
| `createRoom`            | `{ playerName, maxPlayers, stockpileSize }` | `handleCreateRoom`            |
| `joinRoom`              | `{ roomId, playerName }`                    | `handleJoinRoom`              |
| `reconnect`             | `{ roomId, sessionToken, playerName }`      | `handleReconnect`             |
| `startGame`             | _(none)_                                    | `handleStartGame`             |
| `playCard`              | `{ card, source, buildingPileIndex }`       | `handlePlayCard`              |
| `discardCard`           | `{ card, discardPileIndex }`                | `handleDiscardCard`           |
| `sendChatMessage`       | `{ message }`                               | `handleSendChatMessage`       |
| `leaveLobby`            | _(none)_                                    | `handleLeaveLobby`            |
| `leaveGame`             | _(none)_                                    | `handleLeaveGame`             |
| `requestRematch`        | _(none)_                                    | `handleRequestRematch`        |
| `updateRematchSettings` | `{ stockpileSize }`                         | `handleUpdateRematchSettings` |
| `addBot`                | `{ aiType }`                                | `handleAddBot`                |
| `removeBot`             | `{ botPlayerId }`                           | `handleRemoveBot`             |

### Server → Client (emitted by server)

| Event                | Payload                                                        | Handled by                           |
| -------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `roomCreated`        | `{ roomId, playerId, sessionToken, gameState }`                | `messageHandlers.roomCreated`        |
| `playerJoined`       | `{ playerId, playerName, gameState }`                          | `messageHandlers.playerJoined`       |
| `sessionToken`       | `{ playerId, sessionToken }`                                   | `messageHandlers.sessionToken`       |
| `playerLeft`         | `{ playerId, gameState }`                                      | `messageHandlers.playerLeft`         |
| `reconnected`        | `{ roomId, playerId, sessionToken, gameState, playerState }`   | `messageHandlers.reconnected`        |
| `reconnectFailed`    | `{ message }`                                                  | `messageHandlers.reconnectFailed`    |
| `playerReconnected`  | `{ playerId, playerName }`                                     | `messageHandlers.playerReconnected`  |
| `gameStarted`        | `{ gameState, playerState }`                                   | `messageHandlers.gameStarted`        |
| `gameStateUpdate`    | `{ gameState, playerState }`                                   | `messageHandlers.gameStateUpdate`    |
| `gameOver`           | `{ winner, gameState }`                                        | `messageHandlers.gameOver`           |
| `playerDisconnected` | `{ playerId }`                                                 | `messageHandlers.playerDisconnected` |
| `gameAborted`        | _(none)_                                                       | `messageHandlers.gameAborted`        |
| `rematchVoteUpdate`  | `{ rematchVotes, stockpileSize }`                              | `messageHandlers.rematchVoteUpdate`  |
| `playerLeftPostGame` | `{ gameState }`                                                | `messageHandlers.playerLeftPostGame` |
| `chatMessage`        | `{ playerId, playerName, stablePlayerId, message, timestamp }` | `messageHandlers.chatMessage`        |
| `error`              | `{ message }` or `{ code, message }`                           | `messageHandlers.error`              |

## Game Flow

### 1. Room Creation

```
Player A opens app
  → App mounts, useGameConnection creates transport
  → Player fills out lobby form                       (Lobby.js)
  → Lobby calls onCreateRoom(name, max, size)
  → Client sends 'createRoom' via transport
  → Server validates input, creates SkipBoGame
  → Server stores in GameRepository
  → Server sends 'roomCreated' to creator
  → messageHandlers sets roomId, gameState, inLobby=false
  → App renders WaitingRoom
```

### 2. Joining a Room

```
Player B opens app, enters room code
  → Lobby calls onJoinRoom(roomId, name)
  → Client sends 'joinRoom' via transport
  → Server validates room exists, not full
  → Server adds player to SkipBoGame
  → Server sends 'playerJoined' to ALL in room
  → Both clients update gameState
  → Player list updates in WaitingRoom
```

### 3. Adding a Bot

```
Host clicks "Add Bot" in WaitingRoom
  → WaitingRoom calls onAddBot(aiType)
  → Client sends 'addBot' via transport
  → Server creates bot via BotManager.createBot()
  → Server adds bot player to SkipBoGame (connectionId: null)
  → Server sends 'playerJoined' to all humans
  → Bot appears in player list with bot indicator
```

### 4. Starting the Game

```
Any player clicks "Start Game"
  → WaitingRoom calls onStartGame
  → Client sends 'startGame' via transport
  → Server calls game.startGame()
    → Phase transitions to PLAYING
    → Deck created and shuffled
    → Stockpiles dealt (configurable size)
    → Hands dealt (5 cards each)
  → Server sends 'gameStarted' to EACH human player
    (each gets their own playerState)
  → App routing switches to GameBoard
  → If first player is a bot, schedules bot turn
```

### 5. Playing a Card

```
Player clicks a card source (hand/stockpile/discard top)
  → handleCardSelect stores card + source             (GameBoard.js)
  → UI highlights the selected card

Player clicks a building pile
  → BuildingPiles calls onPileClick
  → GameBoard calls onPlayCard via transport
  → Server calls _executePlay()
    → game.playCard() validates and applies move
    → If pile reaches 12: recycle into deck
    → If hand empty: auto-draw 5 cards
    → If stockpile empty: player wins, phase → FINISHED
  → Server sends 'gameStateUpdate' to each human
  → If game over: server sends 'gameOver'
```

### 6. Discarding and Ending a Turn

```
Player clicks "End Turn (Discard a Card)"
  → handleEndTurn sets discardMode=true               (GameBoard.js)
  → UI highlights discard piles as targets

Player clicks a discard pile
  → PlayerArea calls onDiscardPileClick
  → GameBoard calls onDiscardCard via transport
  → Server calls _executeDiscard()
    → game.discardCard() removes card from hand
    → game.endTurn() advances turn, draws for next player
  → Server sends 'gameStateUpdate' + 'turnChanged'
  → If next player is a bot, schedules bot turn
```

### 7. Bot Turn

```
Bot turn timer fires
  → Coordinator calls _playBotTurn(roomId)
  → BotManager.getAI() returns AI instance for this bot
  → AI analyzes game state and finds playable cards
  → For each play: _executePlay() applies and broadcasts
  → When no more plays: _botDiscard() selects and discards
  → _executeDiscard() ends turn and broadcasts
  → If next player is also a bot, schedules another turn
```

### 8. Chat

```
Player types message and submits
  → Chat calls onSendMessage(text)
  → Hook sends 'sendChatMessage' via transport
  → Server sanitizes, broadcasts 'chatMessage' to room
  → All clients append to chatMessages via messageHandler
  → Messages saved to sessionStorage per room
```

### 9. Reconnection

```
Player reloads page
  → App mounts, useGameConnection creates transport
  → On connect, checks localStorage for saved session
  → If session found, sends 'reconnect' with sessionToken
  → Server finds player by sessionToken
  → Server calls game.updateConnectionId(internalId, newConnectionId)
  → SessionManager.transferConnection(oldId, newId)
  → Server sends 'reconnected' with full state
  → messageHandler restores game state
```

### 10. Leaving / Disconnect

```
Player clicks "Leave Game" in waiting room
  → Client sends 'leaveLobby' via transport
  → Server removes player from room
  → If empty: GameRepository.scheduleDeletion() after grace period
  → If others remain: sends 'playerLeft'

Player clicks "Leave Game" during active game
  → Client sends 'leaveGame' via transport
  → Server sends 'gameAborted' to entire room
  → GameRepository.deleteGame() cleans up
  → All clients return to lobby

Player disconnects (tab close, network loss)
  → Server 'disconnect' handler fires
  → If pre-game: removes player, may schedule deletion
  → If mid-game: sends 'playerDisconnected'
    → If humans remain: room persists for reconnection
    → If no humans remain: schedules game deletion after
      grace period (GAME_GRACE_PERIOD_MS), pauses bot turns
  → If post-game: removes rematch vote
    → If no humans remain: schedules game deletion after
      grace period
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
          │          │  │             │  │   (layout)     │
          │ onCreate │  │ gameState   │  │ gameState      │
          │ onJoin   │  │ onStartGame │  │ playerState    │
          └──────────┘  │ onLeaveLobby│  │ onPlayCard     │
                        │ onAddBot    │  │ onDiscardCard  │
                        │ onRemoveBot │  │ onLeaveGame    │
                        └─────────────┘  │ chatMessages   │
                                         │ onSendChat     │
                                         └─┬──┬──┬──┬──┬──┘
                                           │  │  │  │  │
                       ┌───────────────────┘  │  │  │  └───────────┐
                       ▼                      ▼  ▼  ▼              ▼
                 ┌─────────────┐  ┌───────────┐  ┌──────────────┐  ┌──────────────────┐
                 │ OptionsMenu │  │ Opponent  │  │  Building    │  │   PlayerArea     │
                 │ (gear ⚙)    │  │ Area      │  │  Piles       │  │                  │
                 └─────────────┘  └───────────┘  └──────────────┘  │ ┌──────────┐    │
                                                                   │ │PlayerHand│    │
                                                                   │ │  └─Card  │    │
                                                                   │ └──────────┘    │
                                                                   └──────────────────┘
                  ┌──────────────────┐   ┌──────┐
                  │ GameOverOverlay  │   │ Chat │
                  │ rematch controls │   │      │
                  └──────────────────┘   └──────┘
```

## Browser Storage Keys

**localStorage** (persists across sessions):

| Key                  | Value                                            | Used by                       |
| -------------------- | ------------------------------------------------ | ----------------------------- |
| `skipBoSession`      | `{ roomId, playerId, playerName, sessionToken }` | Reconnection on reload        |
| `skipBoPlayerName`   | `"Alice"`                                        | Remember player name in Lobby |
| `skipBoLanguage`     | `"en"`, `"de"`, `"tr"`                           | Language preference            |
| `skipBoQuickDiscard` | `"true"` or `"false"`                            | Quick discard setting          |

**sessionStorage** (cleared when tab closes):

| Key                   | Value                            | Used by                  |
| --------------------- | -------------------------------- | ------------------------ |
| `skipBoChat_{roomId}` | `[{ message, playerName, ... }]` | Chat message persistence |
