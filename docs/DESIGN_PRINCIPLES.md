# Design Principles

> Part of the [project documentation](../README.md#documentation).
> See also: [Architecture](ARCHITECTURE.md) for current design,
> [Technical Debt](TECH_DEBT.md) for known gaps.

This document defines the target architecture: the abstraction layers
the codebase should be organized into, the design patterns each layer
should use, and the quality criteria every change is measured against.
It is aspirational — the current code does not fully match this model,
but every refactoring should move closer to it.

---

## Abstraction Layers

### Principle

Each layer hides the complexity of the layer below it and exposes a
small, well-defined interface to the layer above. A layer may depend on
the layer directly below it. It must never reach past two layers down or
call upward. Cross-cutting concerns (logging, configuration, error
handling) are accessed through injected services, not direct imports.

### Server

```
┌──────────────────────────────────────────────────────┐
│  7. AI Layer                                         │
│     Card evaluation, move selection, strategy         │
│     Operates against Game Engine interface only        │
├──────────────────────────────────────────────────────┤
│  6. Orchestration Layer                              │
│     Routes events to handlers, coordinates layers,    │
│     broadcasts state changes to the right audience    │
├──────────────────────────────────────────────────────┤
│  5. Game Engine Layer                                │
│     Card rules, deck, turns, validation, win check    │
│     Pure domain logic — no I/O, no transport          │
├──────────────────────────────────────────────────────┤
│  4. Room Layer                                       │
│     Room create/join/leave, capacity, host, cleanup   │
├──────────────────────────────────────────────────────┤
│  3. Session Layer                                    │
│     Player identity, tokens, reconnection, ID swap    │
├──────────────────────────────────────────────────────┤
│  2. Transport Layer                                  │
│     Connection lifecycle, event routing, rate limits  │
├──────────────────────────────────────────────────────┤
│  1. Infrastructure Layer                             │
│     HTTP server, Socket.IO, logging, configuration    │
└──────────────────────────────────────────────────────┘
```

#### 1. Infrastructure

**Owns:** HTTP server (Express), Socket.IO instance, structured logger,
configuration loading.

**Hides:** Framework wiring, port binding, CORS setup, environment
variable parsing.

**Interface:** `createServer(config)` returns a running server with
injected dependencies.

**Current state:** `createServer.js` and `server.js` cover this.
Structured logger (`logger.js`) is injected via coordinator constructor.
Configuration centralized in `config.js`.

#### 2. Transport

**Owns:** Socket.IO connection multiplexing, event allowlisting, rate
limiting, send/receive abstraction.

**Hides:** Socket.IO API, connection pooling, serialization format.

**Interface:**

```
send(connectionId, event, data)
sendToGroup(groupId, event, data)
addToGroup(connectionId, groupId)
removeFromGroup(connectionId, groupId)
```

Inbound events are delivered via `onMessage(connectionId, event, data)`.

**Current state:** `SocketIOTransport` is clean and well-abstracted.
Rate-limit constants configurable via `config.js`.

#### 3. Session

**Owns:** Player identity lifecycle — token generation, token
validation, reconnection (mapping a new connection ID to an existing
player), connection-to-room lookup.

**Hides:** Token format, lookup structures, ID swap mechanics.

**Interface:**

```
createSession(connectionId, roomId) → token
validateSession(connectionId, token) → { playerId, roomId }
reconnect(newConnectionId, token) → reconnected player
getRoom(connectionId) → roomId
```

**Current state:** `SessionManager` owns connection-to-room mapping
with `getRoom()`, `setRoom()`, `removeRoom()`, and
`transferConnection()`. Reconnection logic remains in the coordinator
but uses `SessionManager` for lookups and `SkipBoGame.updateConnectionId()`
for ID swap.

#### 4. Room

**Owns:** Room creation and destruction, player join and leave, capacity
enforcement, host assignment and transfer, lobby cleanup timers,
completed-game cleanup timers.

**Hides:** Room ID generation, timer scheduling, host transfer rules.

**Interface:**

```
createRoom(hostId, options) → roomId
joinRoom(playerId, roomId) → success
leaveRoom(playerId) → { room, phase }
getRoom(roomId) → room metadata
```

**Current state:** `GameRepository` owns game storage, cleanup timers,
and room lifecycle queries (`hasGame`, `getAllRoomIds`). Room is still
not a first-class entity separate from the game instance, but storage
is encapsulated behind a repository interface.

#### 5. Game Engine

**Owns:** All game rules. Deck creation and shuffling, dealing, card
play validation, building pile completion, hand refill, discard, turn
advancement, win condition, state serialization.

**Hides:** Shuffle algorithm, pile recycling, hand size management.

**Interface:**

```
addPlayer(id, name) → success
startGame() → success
playCard(playerId, card, source, pileIndex) → result
discardCard(playerId, card, pileIndex) → result
getGameState() → public view
getPlayerState(playerId) → private view
```

**Current state:** `SkipBoGame` in `gameLogic.js` covers this well.
Rematch vote methods (`addRematchVote`, `canStartRematch`, etc.) are
now encapsulated. Players have `internalId` (stable) and
`connectionId` (transport-bound). Bot metadata (`isBot`, `aiType`)
removed — decorated by the coordinator before broadcasting. Player
mutation goes through dedicated methods (`updateConnectionId`,
`setSessionToken`, `setHost`).

#### 6. Orchestration

**Owns:** Wiring layers together. Receives a transport event, resolves
the session, finds the room, delegates to the game engine, and
broadcasts the result. Thin glue — no business logic of its own.

**Hides:** Which layers handle which events, broadcast fan-out logic.

**Interface:** Event handler map consumed by the transport layer.

**Current state:** `GameCoordinator` plays this role. Session tracking,
game storage, and bot AI management have been extracted to dedicated
modules (`SessionManager`, `GameRepository`, `BotManager`). Bot turn
sequencing and reconnection logic remain in the coordinator. Unified
`_executePlay`/`_executeDiscard` methods serve both human and bot
code paths.

#### 7. AI

**Owns:** Card evaluation, chain detection, probability estimation,
move selection, discard strategy.

**Hides:** Scoring heuristics, search depth, evaluation weights.

**Interface:**

```
choosePlay(state) → { card, source, pileIndex } | null
chooseDiscard(state) → { card, pileIndex }
```

**Current state:** Well-isolated. `AIPlayer`, `CardCounter`,
`ChainDetector`, `StateEvaluator` are pure functions operating on state
snapshots. Baseline AI is a separate copy for comparison. Clean.

### Client

```
┌──────────────────────────────────────────────────────┐
│  5. Presentation                                     │
│     Card rendering, animations, CSS, layout           │
├──────────────────────────────────────────────────────┤
│  4. Components                                       │
│     Game board, lobby, waiting room, chat, overlays   │
├──────────────────────────────────────────────────────┤
│  3. Screen Routing                                   │
│     Phase-based navigation: Lobby → WaitingRoom →     │
│     GameBoard, URL parameter handling                 │
├──────────────────────────────────────────────────────┤
│  2. State Management                                 │
│     Game state, chat state, session persistence,      │
│     action dispatch                                   │
├──────────────────────────────────────────────────────┤
│  1. Transport                                        │
│     Socket.IO client, event handling, reconnection    │
└──────────────────────────────────────────────────────┘
```

**Current state:** Layers 1 and 5 are clean. Layer 2 is split between
`useGameConnection` (175 lines) and `messageHandlers.js` (176 lines
of pure handler functions). Layer 3 is handled by `App.js`. Layer 4
has been decomposed: `GameBoard` (177 lines) composes `OpponentArea`,
`BuildingPiles`, `PlayerArea`, `GameOverOverlay`, and
`LeaveConfirmDialog`. `ErrorBoundary` and `ConnectionStatus` provide
client resilience.

### Cross-Cutting Concerns

These are not layers — they are services injected into any layer that
needs them.

| Concern            | Current state                                                            | Target                                                          |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Logging**        | Structured logger (`logger.js`) injected into coordinator                | Extend to transport and other modules as needed                 |
| **Configuration**  | Centralized in `config.js` (game rules, timers, rate limits, Phase enum) | Expose to client for form validation limits                     |
| **Error handling** | `GameError` class with typed `ErrorCodes`; `ErrorBoundary` on client     | Standardize remaining bare string errors in game engine returns |
| **Validation**     | Game rules in engine; I/O sanitization in coordinator                    | Complete — no further action needed                             |

---

## Design Patterns

Each pattern below is chosen because it solves a specific problem in
this project. Patterns are not applied universally — only where the
problem they address actually exists.

### 1. State Machine — Game Phases

**Problem:** The game has three phases (lobby, playing, game-over).
Encoding these as two booleans (`gameStarted`, `gameOver`) creates
ambiguous branching and allows invalid states.

**Pattern:** An explicit phase enum:

```js
const Phase = { LOBBY: 'lobby', PLAYING: 'playing', FINISHED: 'finished' };
game.phase; // single field, exhaustive switch
```

Handlers dispatch on `game.phase`. Adding a new phase (e.g. `PAUSED`)
requires only a new case — no boolean gymnastics.

**Status:** Implemented. `Phase` lives in `config.js`. `SkipBoGame`
owns `this.phase` with backward-compatible `gameStarted`/`gameOver`
getters. All coordinator handlers branch on `game.phase`.

**Where:** `SkipBoGame` owns the phase. Coordinator reads it.

### 2. Observer — Event System

**Problem:** Multiple components need to react to the same event
(a card play triggers state broadcast, logging, turn advancement,
bot scheduling, and game-over checks).

**Pattern:** Already in use via Socket.IO's event system for
client-server communication. The transport layer acts as the event bus.
This is the correct pattern and should remain as-is.

**Extension:** The orchestration layer could emit internal events
(e.g. `turnEnded`, `gameOver`) that other modules subscribe to,
rather than having the coordinator call each module directly. This
would decouple logging, bot scheduling, and analytics from the turn
execution path.

**Where:** Transport layer (external events), orchestration layer
(internal events).

### 3. Mediator — Orchestration

**Problem:** The transport, session, room, and game engine layers need
to collaborate for every player action, but should not know about each
other directly.

**Pattern:** The orchestration layer (GameCoordinator) acts as a
mediator: it receives events from the transport, resolves context via
the session and room layers, delegates to the game engine, and
broadcasts results back through the transport.

The mediator must be thin. If it contains business logic, it has
absorbed a lower layer's responsibility.

**Status:** Session tracking (`SessionManager`), game storage
(`GameRepository`), and bot AI management (`BotManager`) have been
extracted. The coordinator delegates to these modules rather than
owning their data structures directly.

**Where:** `GameCoordinator` is the mediator.

### 4. Strategy — AI Variants

**Problem:** Multiple AI implementations exist (improved, baseline) and
more may be added (MCTS, neural). The coordinator should not know which
strategy a bot uses.

**Pattern:** Already in use. `AIPlayer` and `BaselineAIPlayer` expose
the same interface (`findPlayableCard`, `chooseDiscard`). `BotManager`
selects a strategy at bot creation time and calls it uniformly.

**Extension:** Formalize the interface. Both implementations should
extend a common base or satisfy a documented contract:

```js
// AI strategy contract
{ findPlayableCard(state) → move | null, chooseDiscard(state) → move }
```

**Where:** `server/ai/` modules.

### 5. Command — Game Actions

**Problem:** Game actions (play card, discard, start game) were
handled inline in coordinator methods with duplicated validate →
execute → broadcast logic across human and bot code paths.

**Pattern:** Unified execution methods:

```js
_executePlay(roomId, game, playerId, card, source, pileIndex);
_executeDiscard(roomId, game, playerId, card, discardPileIndex);
```

Both human event handlers and the bot turn driver call these methods.
Game-over checks, state broadcasting, and turn advancement happen in
one place.

**Status:** Implemented via `_executePlay` and `_executeDiscard` in
the coordinator. A full Command pattern (reified command objects with
replay) remains a future option if game logging or replay features
are added.

**Where:** Orchestration layer.

### 6. Repository — Game Storage

**Problem:** Game instances were stored in plain Maps accessed directly
from handler methods, coupling business logic to in-memory storage.

**Pattern:** Wrap storage behind a repository interface:

```js
getGame(roomId) → SkipBoGame | undefined
saveGame(roomId, game) → void
deleteGame(roomId) → void
hasGame(roomId) → boolean
getAllRoomIds() → string[]
```

**Status:** Implemented. `GameRepository` owns game storage and
cleanup timer scheduling (`scheduleDeletion`, `scheduleCompletedCleanup`).
The coordinator accesses games exclusively through the repository.

**Benefit:** Enables future persistence (Redis, database) without
changing business logic. Centralizes cleanup timer management.

**Where:** `server/GameRepository.js`, consumed by the coordinator.

### 7. Facade — Transport

**Problem:** The underlying Socket.IO API is complex (namespaces,
rooms, broadcasting, acknowledgments). Game logic should not be
exposed to this complexity.

**Pattern:** Already in use. `SocketIOTransport` presents a simplified
facade (`send`, `sendToGroup`, `addToGroup`). No changes needed.

**Where:** `server/transport/`, `client/src/transport/`.

### 8. Template Method — Turn Execution

**Problem:** Human turns and bot turns follow the same high-level
structure (validate → execute moves → check win → advance turn →
broadcast) but were implemented as separate code paths.

**Pattern:** Shared execution methods capture the common structure:

```
_executePlay(roomId, game, playerId, card, source, pileIndex)
  ├── game.playCard() → result
  ├── if game over: broadcast, cleanup
  └── broadcast state update

_executeDiscard(roomId, game, playerId, card, pileIndex)
  ├── game.discardCard() → result
  ├── game.endTurn()
  └── broadcast state + schedule next turn
```

Both human event handlers and the bot driver call these methods. The
only difference is how moves are produced (parsed from client event
vs. generated by AI).

**Status:** Implemented via `_executePlay` and `_executeDiscard`.

**Where:** Orchestration layer.

### 9. Projection — State Views

**Problem:** The same underlying game state must be presented
differently to different audiences: public state (all players see
opponent hand counts but not card values) vs. private state (a player
sees their own hand).

**Pattern:** Already in use via `getGameState()` (public projection)
and `getPlayerState(playerId)` (private projection). This is the
correct approach.

**Status:** Bot metadata (`isBot`, `aiType`) is decorated onto the
public projection by the coordinator before broadcasting. The game
engine projects pure game data only.

**Where:** `SkipBoGame` (pure projections), orchestration layer
(decoration).

---

## Quality Criteria

Every change to the codebase should be evaluated against these criteria.
They are listed roughly in order of architectural impact.

### 1. Separation of Concerns

Each module handles one aspect of the system. A module that manages
rooms should not also manage sessions. A component that renders cards
should not also calculate which card is needed next.

**Test:** Can you describe what a module does in one sentence without
using "and"?

### 2. Loose Coupling

Modules depend on interfaces, not implementations. The game engine
does not know about Socket.IO. The transport does not know about cards.
Changes to one module's internals do not force changes elsewhere.

**Test:** Can you swap the implementation of module A without changing
module B?

### 3. High Cohesion

Related functionality lives together. All bot lifecycle code belongs in
one module. All session token logic belongs in one module. If you need
to understand how bots work, you should only need to read one file.

**Test:** When you change a feature, do you touch one file or five?

### 4. Clear Abstraction Layers

Each layer hides complexity from the layer above. The orchestration
layer does not parse Socket.IO frames. The game engine does not
schedule timers.

**Test:** Does each layer's public interface fit on a single screen?

### 5. Modularity

The system is composed of small, self-contained modules that can be
developed, tested, and understood independently. A 970-line class is
not modular; four 200-line classes with clear interfaces are.

**Test:** Can you unit-test a module without mocking half the system?

### 6. Consistency

The same problem is solved the same way everywhere. Error handling
follows one pattern. State access follows one pattern. Validation
follows one pattern.

**Test:** Does a new contributor need to learn one pattern or ten?

### 7. Testability

Modules are designed for testing. Dependencies are injected, not
imported globally. State is accessible through interfaces, not
internal field access. Side effects are isolated.

**Test:** Can you write a test for this module in under 10 lines of
setup?

### 8. Code Reusability

Logic that appears in two places is extracted. Validation rules exist
once. State serialization exists once. The human turn path and the
bot turn path share common logic rather than duplicating it.

**Test:** Does grep find the same logic in more than one file?

### 9. Design Pattern Adherence

When a recognized pattern applies, use it. When it does not apply,
do not force it. Patterns serve the code, not the other way around.

**Test:** Can you name the pattern a module uses? If not, is that
because no pattern fits, or because the design is ad hoc?

### 10. Maintainability

The codebase is easy to change. Small changes require small diffs.
New features slot into existing patterns. Bug fixes are localized.
A developer unfamiliar with the project can orient themselves quickly.

**Test:** Can someone fix a bug in module X without understanding
modules Y and Z?
