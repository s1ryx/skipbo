# Technical Debt & Coupling Analysis

> Part of the [project documentation](../README.md#documentation).
> See also: [Architecture](ARCHITECTURE.md) for the current system design.

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

### React component layer — Clean

Components receive state as props and call callbacks. No direct transport
or server knowledge. The `useGameConnection` hook centralizes all
connection concerns.

## Refactoring Roadmap

If/when these issues warrant fixing, a suggested order:

| Phase | Effort | Change | Benefit |
|-------|--------|--------|---------|
| 1 | Low | Add `BOT_ID_PREFIX` constant and `isBotId()` helper | Explicit convention |
| 2 | Low | Rename `getPublicId(connectionId)` → `getPublicId(playerId)` | Accurate naming |
| 3 | Medium | Extract `BotManager` class from coordinator | Coordinator shrinks ~150 lines, bot logic testable in isolation |
| 4 | Medium | Move `isBot`/`aiType` out of game engine, decorate in coordinator | Game engine stays pure |
| 5 | Medium | Unify human/bot turn execution into shared `_executeTurn()` | Single code path, fewer bugs |
| 6 | High | Separate player identity from connection ID | Clean ID semantics |
