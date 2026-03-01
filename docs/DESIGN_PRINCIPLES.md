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

**Current state:** `createServer.js` and `server.js` cover this. Logger
is absent (bare `console.log`). Config is scattered constants.

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
No changes needed beyond minor configurability (rate limit tuning).

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

**Current state:** Spread across `GameCoordinator` methods
(`handleJoinRoom`, `handleReconnect`) and direct `playerRooms` Map
access. Session token generated inline. No dedicated module.

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

**Current state:** Mixed into `GameCoordinator`. Room is not a first-
class entity — it's a game instance plus side-state in Maps.

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
Issues: `rematchVotes` stored on game but managed externally; `isBot`
and `aiType` leak into the engine; player objects mutated from outside.

#### 6. Orchestration

**Owns:** Wiring layers together. Receives a transport event, resolves
the session, finds the room, delegates to the game engine, and
broadcasts the result. Thin glue — no business logic of its own.

**Hides:** Which layers handle which events, broadcast fan-out logic.

**Interface:** Event handler map consumed by the transport layer.

**Current state:** `GameCoordinator` plays this role but also absorbs
session, room, and bot concerns. Needs to shed responsibilities
downward into the layers above.

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

**Current state:** Layers 1 and 5 are clean. Layers 2–4 are collapsed
into `useGameConnection` (god hook, 337 lines) and `App.js`. `GameBoard`
(449 lines) merges layers 4 and 5.

### Cross-Cutting Concerns

These are not layers — they are services injected into any layer that
needs them.

| Concern | Current state | Target |
|---------|---------------|--------|
| **Logging** | `console.log` in coordinator only | Structured logger injected via config |
| **Configuration** | Constants scattered across files | Single config module with defaults |
| **Error handling** | Inconsistent (silent drops, error events, return objects) | Typed error objects, centralized handler |
| **Validation** | Duplicated between coordinator and game engine | Single source of truth in game engine; coordinator sanitizes I/O only |

---

## Design Patterns

Each pattern below is chosen because it solves a specific problem in
this project. Patterns are not applied universally — only where the
problem they address actually exists.

### 1. State Machine — Game Phases

**Problem:** The game has three phases (lobby, playing, game-over) but
this is encoded as two booleans (`gameStarted`, `gameOver`). Every
handler that behaves differently per phase contains:

```js
if (!game.gameStarted) { /* lobby */ }
else if (game.gameOver) { /* post-game */ }
else { /* mid-game */ }
```

This three-way branch is duplicated in `handleDisconnect`,
`handleLeaveGame`, and several other handlers.

**Pattern:** Replace the boolean pair with an explicit phase enum:

```js
const Phase = { LOBBY: 'lobby', PLAYING: 'playing', FINISHED: 'finished' };
game.phase  // single field, exhaustive switch
```

Handlers dispatch on `game.phase` with a switch statement. Adding a
new phase (e.g. `PAUSED`) requires only a new case — no boolean
gymnastics.

**Where:** `SkipBoGame` owns the phase. Coordinator reads it.

### 2. Observer — Event System

**Problem:** Multiple components need to react to the same event
(a card play triggers state broadcast, logging, turn advancement,
bot scheduling, and game-over checks).

**Pattern:** Already in use via Socket.IO's event system for
client-server communication. The transport layer acts as the event bus.
This is the correct pattern and should remain as-is.

**Extension:** On the server, the orchestration layer could emit
internal events (e.g. `turnEnded`, `gameOver`) that other modules
subscribe to, rather than having the coordinator call each module
directly. This decouples logging, bot scheduling, and analytics from
the turn execution path.

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

**Where:** `GameCoordinator` is the mediator. It should shrink as
session, room, and bot concerns are extracted into their own modules.

### 4. Strategy — AI Variants

**Problem:** Multiple AI implementations exist (improved, baseline) and
more may be added (MCTS, neural). The coordinator should not know which
strategy a bot uses.

**Pattern:** Already in use. `AIPlayer` and `BaselineAIPlayer` expose
the same interface (`findPlayableCard`, `chooseDiscard`). The
coordinator selects a strategy at bot creation time and calls it
uniformly.

**Extension:** Formalize the interface. Both implementations should
extend a common base or satisfy a documented contract:

```js
// AI strategy contract
{ findPlayableCard(state) → move | null, chooseDiscard(state) → move }
```

**Where:** `server/ai/` modules.

### 5. Command — Game Actions

**Problem:** Game actions (play card, discard, start game) are handled
inline in coordinator methods. Each action involves validation,
execution, logging, and response composition — logic that is repeated
across human and bot code paths.

**Pattern:** Represent each action as a command object:

```js
{ type: 'playCard', playerId, card, source, pileIndex }
```

A single `executeCommand(roomId, command)` method validates, applies to
the game engine, logs, and returns the result. Both human handlers and
bot drivers submit commands through the same path.

**Benefit:** Unifies human and bot turn execution. Enables replay
(useful for debugging and game logging). Makes it easy to add
cross-cutting hooks (analytics, rate limiting per action).

**Where:** Orchestration layer.

### 6. Repository — Game Storage

**Problem:** Game instances are stored in plain Maps (`this.games`,
`this.playerRooms`). Storage is accessed directly from handler methods,
creating tight coupling between business logic and in-memory storage.

**Pattern:** Wrap storage behind a repository interface:

```js
{ getGame(roomId), saveGame(game), deleteGame(roomId),
  getPlayerRoom(playerId), setPlayerRoom(playerId, roomId) }
```

**Benefit:** Enables future persistence (Redis, database) without
changing business logic. Makes testing easier (inject mock repository).
Centralizes cache invalidation and cleanup.

**Where:** New module consumed by orchestration and room layers.

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
broadcast) but are implemented as separate code paths with duplicated
logic.

**Pattern:** Define a template method that captures the shared structure:

```
executeTurn(roomId, playerId, moves[])
  ├── for each move: validate → apply → log
  ├── if game over: broadcast, cleanup
  └── advance turn → broadcast → schedule next (bot or wait for human)
```

Both human event handlers and the bot driver call this method. The
only difference is how moves are produced (parsed from client event
vs. generated by AI).

**Where:** Orchestration layer, replacing the parallel code paths in
`handlePlayCard`/`handleDiscardCard` and `_playBotTurn`/`_botDiscard`.

### 9. Projection — State Views

**Problem:** The same underlying game state must be presented
differently to different audiences: public state (all players see
opponent hand counts but not card values) vs. private state (a player
sees their own hand).

**Pattern:** Already in use via `getGameState()` (public projection)
and `getPlayerState(playerId)` (private projection). This is the
correct approach.

**Extension:** Bot metadata (`isBot`, `aiType`) should be decorated
onto the public projection by the orchestration layer, not stored in
the game engine. The game engine projects pure game data; the
coordinator enriches it with infrastructure metadata before sending.

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
