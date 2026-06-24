# Technical Debt & Coupling Analysis

> Part of the [project documentation](../README.md#documentation).
> See also: [Architecture](ARCHITECTURE.md) for the current system design,
> [Design Principles](DESIGN_PRINCIPLES.md) for the target architecture.

Known coupling issues, architectural smells, and potential refactoring
targets. Items are ordered by impact — highest first.

## Active Issues

### 1. GameCoordinator still orchestrates bot turns inline

**Severity: Low-Medium** | **File:** `server/gameCoordinator.js`
(~1020 lines)

`BotManager` was extracted to own bot AI instances and timer
scheduling, but the coordinator still contains the bot turn
orchestration logic (`_scheduleBotTurnIfNeeded`, `_playBotTurn`,
`_botDiscard` — ~60 lines). These methods use the unified
`_executePlay`/`_executeDiscard` helpers, so duplication is minimal,
but the coordinator's line count remains high.

**Why it matters:** The coordinator mixes orchestration glue with bot
turn sequencing. Understanding bot behavior requires reading both
`BotManager` and the coordinator.

**Possible fix:** Move `_playBotTurn` and `_botDiscard` into
`BotManager`, passing a callback for `_executePlay`/`_executeDiscard`.
The coordinator would call `botManager.scheduleTurn(roomId, callback)`
and the callback would handle state broadcasting.

---

### 2. `useGameConnection` still handles multiple concerns

**Severity: Low-Medium** | **File:**
`client/src/useGameConnection.js` (175 lines)

After message handler extraction (Phase 4.1), the hook dropped from
337 to 175 lines. It still manages transport lifecycle, game state,
session persistence, chat state, rematch state, and action callbacks
in a single module. Splitting into focused hooks (Phase 4.2) was
evaluated and deferred — the current size is manageable.

**Why it matters:** All state lives in one hook. Changes to chat
persistence could theoretically affect game state, though in practice
the concerns are cleanly separated by `useState` boundaries.

**Possible fix:** Split into `useServerConnection`,
`useGameState`, `useChatState`, and a thin `useGameConnection`
composition. Only worth doing if the hook grows again.

---

### 3. Client-side game constant duplication

**Severity: Low** | **Files:** `client/src/components/Lobby.js`,
`server/config.js`

`Lobby.js` hardcodes stockpile range (5–30) and max players (2–6).
These values exist in `server/config.js` but are not shared with
the client.

**Why it matters:** If game limits change server-side, the client
form validation could silently allow out-of-range values.

**Possible fix:** Expose limits via a server endpoint or shared
config package. Low priority — limits rarely change.

---

### 4. Create React App (react-scripts) is unmaintained

**Severity: Medium** | **Files:** `client/` (build tooling)

The client builds with Create React App (`react-scripts`), which is no
longer maintained. Consequences observed: webpack cannot statically
drop a gated `import()` (the debug-console `eruda` chunk ships in
production builds despite a runtime gate), `caniuse-lite`/browserslist
data goes stale and needs manual refresh, and build/test times are slow.

**Why it matters:** No upstream patches for the build toolchain; the
dynamic-import limitation forces awkward workarounds (e.g. CDN loading)
to keep a dev-only dependency out of the production bundle.

**Possible fix:** Migrate to Vite — proper tree-shaking / conditional
chunk elimination, maintained tooling, faster builds. Sizeable but
mostly mechanical; isolate behind its own branch.

---

### 5. Duplicated and dead code in rematch / disconnect handling

**Severity: Low** | **Files:** `server/gameCoordinator.js`,
`server/gameLogic.js`

- `SkipBoGame.resetForRematch(stockpileSize)` declares a `stockpileSize`
  parameter the coordinator never passes (size is applied earlier via
  `updateStockpileSize`) — a dead parameter.
- The "human whose connection is no longer mapped" predicate
  (`!sessionManager.hasRoom(p.connectionId)`) is duplicated in
  `handleStartGame` and `handleRequestRematchWithoutDisconnected`.

**Why it matters:** Minor, but the dead parameter misleads readers and
the duplicated predicate can drift between the two call sites.

**Possible fix:** Drop the unused parameter; extract a
`_disconnectedHumans(game)` helper (coordinator or `SessionManager`) and
use it in both places.

---

### 6. Only error translations have a parity test

**Severity: Low** | **Files:** `client/src/i18n/`,
`client/src/i18n/translations.test.js`

`translations.test.js` asserts every `ErrorCode` has en/de/tr
translations, but does not check parity for the much larger set of
`game.*` / `lobby.*` / etc. keys. A new UI key can be added to one
locale and silently missing from the others.

**Why it matters:** Untranslated UI strings reach users in non-English
locales with no test catching the omission.

**Possible fix:** Extend `translations.test.js` to assert all three
locale files share an identical key set.

---

### 7. ARCHITECTURE.md permalink and line-number drift

**Severity: Low** | **File:** `docs/ARCHITECTURE.md`

Several permalinks cite stale commit SHAs / line ranges (e.g.
`_executePlay` / `_executeDiscard` referenced near L868/L907 but now
past L1240) and line counts are out of date; recent merges (notably the
debug-logging branch) did not refresh references.

**Why it matters:** The doc's value depends on permalinks resolving to
the right code; drift erodes trust in it.

**Possible fix:** One refresh pass per the pre-merge checklist (blame
each referenced block, update SHA + the line range _at that commit_ +
counts). A small drift-detection script would make this repeatable.

---

## Resolved Issues

These issues were identified during the initial analysis and have
been addressed by the refactoring work.

### Configuration scattered across files — Resolved

**Was: Issue #13** | `server/config.js` centralizes all game
constants, room limits, timer values, rate-limit settings, and the
`Phase` enum. Consumers import from a single source.

### No game phase enum — Resolved

**Was: Issue #12** | `Phase` enum (`LOBBY`, `PLAYING`, `FINISHED`)
in `config.js`. `SkipBoGame` tracks `this.phase` with backward-
compatible getters. All coordinator handlers use `game.phase` with
exhaustive branching.

### Synthetic bot ID format is implicit — Resolved

**Was: Issue #5** | `BOT_ID_PREFIX` constant and `isBotId()` helper
in `config.js`. All bot ID generation and detection use these.

### Player ID overloading — Resolved

**Was: Issue #2** | Players now have `internalId` (stable UUID),
`connectionId` (transport target, null for bots), and `publicId`
(display ID). The game engine operates on `internalId` internally.
On reconnect, `updateConnectionId()` changes transport binding
without affecting game identity. `getPublicId()` parameter renamed
to `playerId`.

### Bot metadata in game engine — Resolved

**Was: Issue #3** | `isBot` and `aiType` removed from `SkipBoGame`.
The coordinator decorates game state with bot metadata before
broadcasting, using `BotManager` lookups.

### Rematch state managed outside the game engine — Resolved

**Was: Issue #7** | `SkipBoGame` now owns `addRematchVote()`,
`removeRematchVote()`, `clearRematchVotes()`, and
`canStartRematch()`. The coordinator calls these methods instead
of manipulating the Set directly.

### Duplicate validation between coordinator and engine — Resolved

**Was: Issue #8** | Game rules validation (capacity, stockpile
limits) consolidated in `SkipBoGame`. The coordinator handles I/O
sanitization only (type checking, trimming, name length).

### Direct player object mutation from coordinator — Resolved

**Was: Issue #9** | `SkipBoGame` exposes `updateConnectionId()`,
`setSessionToken()`, and `setHost()`. The coordinator no longer
reaches into player objects directly.

### Session management has no dedicated module — Resolved

**Was: Issue #6** | `SessionManager` owns connection-to-room
mapping, with `getRoom()`, `setRoom()`, `removeRoom()`, and
`transferConnection()`. Token generation remains simple (inline
`crypto.randomUUID()` — extracting it added no value).

### GameCoordinator has too many responsibilities — Largely resolved

**Was: Issue #1** | Three modules extracted: `SessionManager`
(connection tracking), `BotManager` (AI instances and timers),
`GameRepository` (game storage and cleanup timers). The coordinator
dropped from absorbing 5 concerns to primarily orchestration glue,
though bot turn sequencing remains inline (see Active Issue #1).

### Asymmetric turn execution paths — Resolved

**Was: Issue #4** | Unified `_executePlay()` and `_executeDiscard()`
methods handle both human and bot code paths. Game-over checks,
state broadcasting, and turn advancement happen in one place.

### `useGameConnection` is a god hook — Largely resolved

**Was: Issue #10** | Message handlers extracted to
`messageHandlers.js` (176 lines of pure functions). The hook
dropped from 337 to 175 lines. Further splitting (Phase 4.2) was
deferred as unnecessary at current size (see Active Issue #2).

### GameBoard component is too large — Resolved

**Was: Issue #11** | Five sub-components extracted: `OpponentArea`
(75 lines), `BuildingPiles` (46 lines), `PlayerArea` (132 lines),
`GameOverOverlay` (81 lines), `LeaveConfirmDialog` (24 lines).
`GameBoard` dropped from 449 to 177 lines. `getNextCardForPile`
moved to `utils/cardUtils.js`.

### Inconsistent error handling — Largely resolved

**Was: Issue #14** | `GameError` class with typed `ErrorCodes` in
`errors.js`. Structured logger (`logger.js`) replaces bare
`console.log`. `ErrorBoundary` and `ConnectionStatus` components
added to the client. Error translations added to all three
languages.

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

### Server module structure — Clean

`SessionManager`, `BotManager`, `GameRepository`, `config.js`,
`logger.js`, and `errors.js` are small, focused modules (29–74 lines
each) with clear interfaces. Each is independently testable with
dedicated test suites.

### Test coverage — Good

413 server tests (unit + integration + AI) and 170 client tests
cover critical paths. The test infrastructure (mock transport, state
helpers, render helpers) is well-designed. All new modules have
dedicated test files.
