# Technical Debt & Coupling Analysis

> Part of the [project documentation](../README.md#documentation).
> See also: [Architecture](ARCHITECTURE.md) for the current system design,
> [Design Principles](DESIGN_PRINCIPLES.md) for the target architecture.

Known coupling issues, architectural smells, and potential refactoring
targets. Items are ordered by impact — highest first.

## Active Issues

### 1. GameCoordinator has too many responsibilities

**Severity: High** | **File:** `server/gameCoordinator.js` (~970 lines)

The coordinator handles five distinct concerns in a single class:

1. Room lifecycle (create, join, leave, disconnect, cleanup timers)
2. Human turn processing (receive event → game engine → broadcast)
3. Bot management (add/remove bots, schedule turns, execute AI, cleanup)
4. Game logging (snapshot state, analyze moves, write JSONL)
5. State broadcasting (different code paths for humans vs bots)

Bot orchestration alone adds ~150 lines (`_scheduleBotTurnIfNeeded`,
`_playBotTurn`, `_botDiscard`, `_handleBotGameOver`, `_broadcastToHumans`,
`_clearBotTimers`, `_clearBotAIs`) interleaved with the human turn logic.

**Why it matters:** Hard to understand bot orchestration in isolation.
Changes to bot logic require careful coordination with game flow. Logging
hooks are scattered across handler methods.

**Possible fix:** Extract a `BotManager` class that owns `botAIs`,
`botTurnTimers`, and all `_bot*` / `_schedule*` / `_clear*` methods. The
coordinator would call `botManager.onTurnEnd(roomId)` instead of
`_scheduleBotTurnIfNeeded(roomId)`.

---

### 2. Player ID overloading

**Severity: Medium** | **Files:** `server/gameLogic.js`, `server/gameCoordinator.js`

`player.id` in `SkipBoGame` serves two unrelated purposes:

- **Game identity** — who is this player in the game
- **Transport target** — where to send messages (Socket.IO connection ID)

For human players, `player.id` is a Socket.IO connection ID (e.g.
`"PaDv0iEeEt2GlbiJAAAB"`). For bots, it's a synthetic ID (e.g.
`"bot-a1b2c3d4-..."`). The transport silently drops sends to non-existent
bot IDs, but this is an implicit assumption — nothing enforces it.

The `getPublicId(connectionId)` method name is misleading: it accepts any
player ID, not just connection IDs.

**Why it matters:** When tracing ID values through the code, it's unclear
which kind of ID is expected. On reconnect, the connection ID changes but
the game identity should persist — this is handled by swapping `player.id`
to the new connection ID, which further blurs the distinction.

**Possible fix:** Introduce an explicit separation:

```js
// Option A: separate fields
player.internalId  // stable game identity (UUID)
player.connectionId  // transport target (null for bots)

// Option B: typed wrapper
{ type: 'human', connectionId: '...' }
{ type: 'bot', botId: '...' }
```

---

### 3. Bot metadata in game engine

**Severity: Medium** | **File:** `server/gameLogic.js:304-305`

`getGameState()` returns `isBot` and `aiType` per player. These are
infrastructure concerns (how a player is controlled), not game rules
concerns (what cards they have). The game engine shouldn't need to know
whether a player is human or AI.

Currently the coordinator sets these fields by mutating the player object
after `addPlayer()`:

```js
botPlayer.isBot = true;
botPlayer.aiType = validAiType;
```

And `getGameState()` exposes them:

```js
isBot: !!p.isBot,
aiType: p.aiType || null,
```

**Why it matters:** The game engine is now coupled to bot infrastructure.
Adding a new player type (e.g. spectator-controlled, remote AI service)
would require modifying `getGameState()` again.

**Possible fix:** Track bot status in the coordinator only. Before
broadcasting, the coordinator decorates the game state with bot metadata:

```js
const state = game.getGameState();
state.players = state.players.map(p => ({
  ...p,
  isBot: this.botAIs.has(`${roomId}:${p.id}`),
  aiType: this.botAIs.get(`${roomId}:${p.id}`)?.type || null,
}));
```

---

### 4. Asymmetric turn execution paths

**Severity: Low-Medium** | **File:** `server/gameCoordinator.js`

Humans and bots take turns through completely different code paths:

- **Human:** client emits event → transport → `handlePlayCard()` →
  `game.playCard()` → send to all players via `game.players.forEach()`
- **Bot:** coordinator timer fires → `_playBotTurn()` →
  `game.playCard()` → send to humans only via `_broadcastToHumans()`

Both paths duplicate the pattern: execute move → check game over →
broadcast state. The broadcast targets also differ (all players vs
humans only).

**Why it matters:** Bug fixes to the turn execution pattern must be
applied in two places. Adding cross-cutting concerns (e.g. move
validation hooks, analytics) requires touching both paths.

**Possible fix:** Unify into a single `_executeTurn()` method that both
human handlers and the bot driver call. This method would handle game
engine calls, game-over checks, logging, and broadcasting.

---

### 5. Synthetic bot ID format is implicit

**Severity: Low** | **File:** `server/gameCoordinator.js:524`

Bot IDs are generated as `'bot-' + crypto.randomUUID()`. Nothing
explicitly documents or enforces that IDs starting with `'bot-'` are
synthetic. The convention is only implied by the code that generates them.

**Why it matters:** Fragile assumption. If any other code path happened
to create an ID with the `bot-` prefix, it would cause confusion. Also
makes it harder to identify bots when debugging.

**Possible fix:** Add a constant and a helper:

```js
const BOT_ID_PREFIX = 'bot-';
const isBotId = (id) => id.startsWith(BOT_ID_PREFIX);
```

---

### 6. Session management has no dedicated module

**Severity: Medium** | **File:** `server/gameCoordinator.js`

Session logic (token generation, token validation, reconnect ID swap,
`playerRooms` lookup) is scattered across `handleJoinRoom`,
`handleReconnect`, and `handleDisconnect`. Token generation uses
`crypto.randomUUID()` inline. The `playerRooms` Map is accessed from
nearly every handler.

**Why it matters:** Session concerns cross-cut all handlers but are not
encapsulated. Reconnection alone is 95 lines with two distinct code
paths (same player vs. new player rejoining). Understanding session
lifecycle requires reading the entire coordinator.

**Possible fix:** Extract a `SessionManager` class that owns
`playerRooms`, token generation, and reconnection logic:

```js
class SessionManager {
  createSession(connectionId, roomId) → token
  validateToken(token) → { playerId, roomId }
  reconnect(newConnectionId, token) → player
  getRoom(connectionId) → roomId
}
```

**Violates:** Separation of Concerns, High Cohesion, Modularity
([Design Principles](DESIGN_PRINCIPLES.md)).

---

### 7. Rematch state managed outside the game engine

**Severity: Medium** | **File:** `server/gameCoordinator.js`

`rematchVotes` is a `Set` stored on the `SkipBoGame` object but
mutated exclusively by the coordinator: `.add()`, `.delete()`,
`.clear()` in five handlers. `resetForRematch()` and
`canStartRematch()` logic is in the coordinator, not the game.

**Why it matters:** Rematch is game lifecycle logic. Keeping it in the
coordinator means the game engine cannot enforce its own invariants
(e.g. votes should be cleared when a player leaves).

**Possible fix:** Add game engine methods:

```js
game.addRematchVote(playerId)
game.removeRematchVote(playerId)
game.clearRematchVotes()
game.canStartRematch() → boolean
game.updateRematchSettings(stockpileSize)
```

**Violates:** Separation of Concerns, Loose Coupling.

---

### 8. Duplicate validation between coordinator and game engine

**Severity: Medium** | **Files:** `server/gameCoordinator.js`,
`server/gameLogic.js`

Stockpile size is validated in two places with different rules:

- Coordinator (`handleCreateRoom`): `size >= 1 && size <= 30`
- Game engine (`startGame`): `Math.min(size, playerCount <= 4 ? 30 : 20)`

Player name validation exists only in the coordinator (utility
function called four times). `MIN_PLAYERS` and `MAX_PLAYERS` are
coordinator constants not shared with the game engine.

**Why it matters:** Different validation rules in different layers
create ambiguity about which layer is authoritative. The coordinator
allows `stockpileSize: 30` for a 5-player game, but the engine
silently clamps it to 20.

**Possible fix:** Move all game rules validation to `SkipBoGame`. The
coordinator sanitizes I/O (type checking, trimming) and the engine
validates game rules (capacity, stockpile limits).

**Violates:** Consistency, Code Reusability.

---

### 9. Direct player object mutation from coordinator

**Severity: Medium** | **File:** `server/gameCoordinator.js`

The coordinator directly mutates player objects owned by the game
engine:

```js
player.id = connectionId;        // reconnect
player.sessionToken = token;      // join
player.isBot = true;              // add bot
player.aiType = validAiType;      // add bot
game.hostPublicId = publicId;     // host transfer
```

**Why it matters:** The game engine cannot enforce invariants on its
own state. Player identity changes bypass any internal bookkeeping.
The game engine has no `setPlayerId()` or `setHost()` methods — the
coordinator reaches in directly.

**Possible fix:** Add encapsulated mutators to `SkipBoGame`:

```js
game.setPlayerId(oldId, newId)
game.setSessionToken(playerId, token)
game.setHost(publicId)
```

**Violates:** Loose Coupling, Clear Abstraction Layers.

---

### 10. `useGameConnection` is a god hook

**Severity: High** | **File:** `client/src/useGameConnection.js`
(337 lines)

The hook manages nine concerns in a single module:

1. Transport creation and connection lifecycle
2. All game state (`gameState`, `playerState`, `playerId`)
3. Session persistence (sessionStorage read/write)
4. Chat message state and persistence
5. Rematch voting state
6. Reconnection logic
7. 13 server event handlers (186-line `useEffect`)
8. 9 action callbacks (`createRoom`, `playCard`, etc.)
9. Error display with auto-dismiss timer

The 186-line `useEffect` defines every message handler inline. No
handler is independently testable.

**Why it matters:** Any change to one concern (e.g. chat) risks
affecting unrelated concerns (e.g. reconnection). The hook is the
single largest source of complexity on the client. Testing it
requires mocking the entire server protocol.

**Possible fix:** Split into focused hooks:

- `useServerConnection` — transport, connect/disconnect, reconnection
- `useGameState` — game state, player state, session persistence
- `useChatState` — chat messages, read status, sessionStorage
- Extract `messageHandlers.js` — pure functions, independently testable

**Violates:** Separation of Concerns, High Cohesion, Modularity,
Testability.

---

### 11. GameBoard component is too large

**Severity: Medium** | **File:** `client/src/components/GameBoard.js`
(449 lines)

`GameBoard` handles rendering, card selection state, discard mode,
quick-discard settings, leave confirmation, game-over/rematch overlay,
chat integration, and game logic calculations (`getNextCardForPile`).
It receives 14 props.

`getNextCardForPile()` re-implements Skip-Bo card sequencing rules
that already exist server-side in `gameLogic.js`. This creates a risk
of client and server logic diverging.

**Why it matters:** A 449-line component with 14 props is hard to
review, test, and modify. The game logic duplication means card
display rules could silently drift from actual game rules.

**Possible fix:** Extract sub-components and a shared utility:

- `OpponentArea` — opponent info and piles
- `BuildingPiles` — center piles with click handling
- `PlayerArea` — stockpile, discard, hand
- `GameOverOverlay` — winner display, rematch voting
- `LeaveConfirmDialog` — confirmation modal
- `gameUtils.js` — shared card logic (or compute server-side)

**Violates:** Modularity, Separation of Concerns, Code Reusability.

---

### 12. No game phase enum

**Severity: Low-Medium** | **Files:** `server/gameLogic.js`,
`server/gameCoordinator.js`

Game phase is encoded as two booleans: `gameStarted` (boolean) and
`gameOver` (boolean). Every phase-dependent handler contains:

```js
if (!game.gameStarted) { /* lobby */ }
else if (game.gameOver) { /* post-game */ }
else { /* mid-game */ }
```

This three-way branch appears in `handleDisconnect`,
`handleLeaveGame`, `handleRequestRematch`, and others.

**Why it matters:** Adding a new phase (e.g. `PAUSED`) requires
finding and updating every branching site. The boolean pair also
allows an invalid state (`gameStarted: false, gameOver: true`).

**Possible fix:** Replace with an enum:

```js
const Phase = { LOBBY: 'lobby', PLAYING: 'playing', FINISHED: 'finished' };
game.phase  // single field, exhaustive switch
```

**Violates:** Consistency, Design Pattern Adherence (State Machine
pattern).

---

### 13. Configuration scattered across files

**Severity: Low** | **Files:** Multiple

Game constants are hardcoded across unrelated files:

- `gameCoordinator.js`: `MIN_PLAYERS`, `MAX_PLAYERS`, `LOBBY_GRACE_MS`,
  `COMPLETED_GAME_CLEANUP_MS`, `MAX_CHAT_LENGTH`, 8 more
- `SocketIOTransport.js`: `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_EVENTS`
- `gameLogic.js`: hand size (5), pile count (4), max card (12), deck
  composition — all as inline literals

The client also has its own copies: `Lobby.js` hardcodes stockpile
range (5–30), max players (2–6).

**Why it matters:** Changing a game rule (e.g. hand size) requires
finding every hardcoded instance. Client and server can disagree on
limits.

**Possible fix:** Single `config.js` module:

```js
module.exports = {
  game: { HAND_SIZE: 5, MAX_CARD: 12, BUILDING_PILES: 4, ... },
  room: { MIN_PLAYERS: 2, MAX_PLAYERS: 6, ... },
  timers: { LOBBY_GRACE_MS: 30000, ... },
  rateLimit: { WINDOW_MS: 10000, MAX_EVENTS: 30 },
};
```

**Violates:** Consistency, Code Reusability.

---

### 14. Inconsistent error handling

**Severity: Low-Medium** | **Files:** Multiple

Three different error patterns coexist:

- **Coordinator:** sends `error` event via transport, returns early
- **Game engine:** returns `{ success: false, error: 'string' }`
- **Transport:** emits `error` event on rate limit

On the client, errors auto-dismiss after 3 seconds with no retry
logic. Failed sends via `transportRef.current?.send()` are silently
dropped if the transport is not ready.

`console.log` is the only server-side logging (20 calls in
coordinator, zero in game engine and transport).

**Why it matters:** Silent failures are hard to debug. Inconsistent
error shapes make client error handling brittle. No structured logging
means production issues require reading raw stdout.

**Possible fix:**

- Standardize server errors: `{ code: 'error.roomFull', message: '...' }`
- Add structured logger (injected, not imported globally)
- Client: connection status indicator, retry for transient failures

**Violates:** Consistency, Maintainability.

---

## Non-Issues (Reviewed and Acceptable)

### Transport layer decoupling — Clean

Both `SocketIOTransport` and `SocketIOClientTransport` are fully
decoupled from game logic. They know nothing about players, games, or
rules. The generic `send(connectionId, event, data)` / `onMessage`
interface could be swapped for SSE, WebSockets, or polling without
touching any other layer.

### AI engine decoupling — Clean

`AIPlayer` and `BaselineAIPlayer` are pure functions: take state
snapshots, return decisions. No side effects, no game mutation, no
transport awareness. Fully reusable in self-play scripts, tests, or
server-side bot integration.

### React presentational components — Clean

`Card`, `PlayerHand`, and `Chat` are focused, stateless (or near-
stateless) components with clear props interfaces. No transport or
server knowledge.

### i18n system — Clean

`LanguageContext` provides a clean context-based translation system
with interpolation and basic pluralization. Components access
translations via `useTranslation()` without prop drilling.

### Test coverage — Adequate

317 server tests (unit + integration + AI) and comprehensive client
test suites cover critical paths. The test infrastructure (mock
transport, server manager, render helpers) is well-designed.

---

## Refactoring Roadmap

Phased approach moving the codebase toward the target architecture
defined in [Design Principles](DESIGN_PRINCIPLES.md). Each phase is
independently shippable.

### Phase 1 — Quick wins (Low effort)

| # | Change | Benefit |
|---|--------|---------|
| 1 | Add `BOT_ID_PREFIX` constant and `isBotId()` helper | Explicit convention |
| 2 | Rename `getPublicId(connectionId)` → `getPublicId(playerId)` | Accurate naming |
| 3 | Add game phase enum (`LOBBY`, `PLAYING`, `FINISHED`) | Eliminate boolean pair, enable exhaustive matching |
| 4 | Extract game constants to shared `config.js` | Single source of truth for rules and limits |

### Phase 2 — Server encapsulation (Medium effort)

| # | Change | Benefit |
|---|--------|---------|
| 5 | Add rematch methods to `SkipBoGame` | Game engine owns its lifecycle |
| 6 | Add player mutators to `SkipBoGame` (`setPlayerId`, `setHost`) | Enforce invariants |
| 7 | Move validation to game engine, sanitize I/O in coordinator | No duplicate rules |
| 8 | Move `isBot`/`aiType` out of game engine, decorate in coordinator | Pure domain model |

### Phase 3 — Server extraction (Medium-High effort)

| # | Change | Benefit |
|---|--------|---------|
| 9 | Extract `BotManager` from coordinator | Bot logic testable in isolation |
| 10 | Extract `SessionManager` from coordinator | Session logic centralized |
| 11 | Unify human/bot turn execution into `_executeTurn()` | Single code path |
| 12 | Add structured logging (replace `console.log`) | Production-ready observability |

### Phase 4 — Client restructuring (Medium effort)

| # | Change | Benefit |
|---|--------|---------|
| 13 | Split `useGameConnection` into focused hooks | Each hook testable in isolation |
| 14 | Extract `GameBoard` sub-components | Smaller, focused components |
| 15 | Extract `messageHandlers.js` from god hook | Pure functions, easy to test |
| 16 | Move `getNextCardForPile` to shared utility | Eliminate client-server logic duplication |

### Phase 5 — Architecture alignment (High effort)

| # | Change | Benefit |
|---|--------|---------|
| 17 | Separate player identity from connection ID | Clean ID semantics |
| 18 | Introduce game repository abstraction | Storage-agnostic game persistence |
| 19 | Add error boundary and connection status to client | Graceful failure handling |
| 20 | Standardize error objects across all layers | Consistent error handling |
