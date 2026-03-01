# Testing

This document defines the testing expectations for the project: what must
be tested, what tooling is used, and how tests are organized.

## Philosophy

Test the core behavior that matters — game rules, coordinator event
handling, component rendering, and hook state management. The goal is
confidence that the application works correctly, not a coverage number.
100% coverage is not a target; meaningful coverage of critical paths is.

**When to write tests:**

- New game logic (rules, win conditions, edge cases)
- New coordinator event handlers
- New React components or significant UI behavior
- New hooks or state management logic
- Bug fixes (regression test proving the fix)
- New utility modules with non-trivial logic

**When tests are optional:**

- Pure CSS/styling changes
- Configuration files (`.eslintrc`, `.prettierrc`, `package.json`)
- Static content (translations, markdown docs)
- Simple one-line wrappers or re-exports
- Scripts intended for manual/development use (`scripts/`)

## Frameworks

### Server

- **[Jest](https://jestjs.io/)** (v30) for unit and integration tests
- Run: `cd server && npx jest`
- Watch mode: `cd server && npx jest --watch`
- Single suite: `cd server && npx jest --testPathPattern=unit/gameLogic`

### Client

- **[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)** with Jest (via Create React App)
- Run: `cd client && npx react-scripts test --watchAll=false`
- Watch mode: `cd client && npx react-scripts test`

## Test Organization

```
server/
├── tests/
│   ├── unit/                      # Unit tests for core modules
│   │   ├── gameLogic.test.js      # SkipBoGame class
│   │   └── gameCoordinator.test.js # GameCoordinator handlers
│   ├── integration/               # Multi-module interaction tests
│   │   ├── lobby.test.js          # Room creation/joining flow
│   │   ├── fullGame.test.js       # Complete game lifecycle
│   │   ├── session.test.js        # Reconnection and session persistence
│   │   ├── chat.test.js           # Chat messaging
│   │   ├── gameAbort.test.js      # Game abort and cleanup
│   │   ├── raceConditions.test.js # Concurrent event handling
│   │   └── rateLimiting.test.js   # Rate limiter behavior
├── transport/
│   └── SocketIOTransport.test.js  # Transport adapter tests

client/src/
├── App.test.js                    # Top-level routing
├── useGameConnection.test.js      # Hook state and event handling
├── components/
│   ├── Card.test.js
│   ├── Chat.test.js
│   ├── GameBoard.test.js
│   ├── Lobby.test.js
│   ├── PlayerHand.test.js
│   └── WaitingRoom.test.js
└── transport/
    └── SocketIOClientTransport.test.js
```

### Placement rules

- **Server unit tests** go in `server/tests/unit/`
- **Server integration tests** go in `server/tests/integration/`
- **Transport tests** live next to their adapter (`server/transport/`)
- **Client tests** are co-located with their source file

## What Must Be Tested

### Game logic (`gameLogic.js`)

Every public method on `SkipBoGame` should have test coverage:

- Deck creation and shuffling
- Adding players and dealing cards
- Playing cards from each source (hand, stockpile, discard pile)
- Building pile completion and recycling
- SKIP-BO wild card behavior
- Discard and end turn mechanics
- Win condition detection
- Invalid move rejection (wrong turn, illegal card placement)
- Edge cases (empty deck recycling, mid-turn hand refill)

### Coordinator (`gameCoordinator.js`)

Each event handler should be tested for its happy path and key error
cases:

- Room creation, joining, and capacity limits
- Game start validation
- Play card and discard card forwarding
- Turn advancement and state broadcasting
- Reconnection (ID swap, state restoration)
- Leave and disconnect cleanup
- Chat message relay
- Bot add/remove (when applicable)

### React components

Test rendering and user interaction, not implementation details:

- Components render correct content for given props
- User interactions trigger the right callbacks
- Conditional rendering (loading states, turn indicators, overlays)
- Error and edge states (disconnected players, game over)

### Hooks (`useGameConnection`)

- State transitions in response to server events
- Action functions send correct events through transport
- Session persistence to sessionStorage
- Reconnection flow

### AI modules (when present)

- Each exported function or class method
- Edge cases in chain detection and scoring
- Probability calculations

## Test Patterns

### Server: mock transport

Integration tests use a `MockTransport` that captures emitted events
without a real Socket.IO server:

```js
class MockTransport {
  constructor() { this.sent = []; }
  send(id, event, data) { this.sent.push({ id, event, data }); }
  sendToGroup(group, event, data) { this.sent.push({ group, event, data }); }
  // ...
}
```

### Server: state helpers

Test files define `makeState()` or `makeGameState()` helpers to build
minimal state objects, keeping individual tests focused on only the
fields they care about:

```js
function makeState(overrides = {}) {
  return {
    playerState: {
      hand: overrides.hand || [],
      stockpileTop: overrides.stockpileTop ?? null,
      // ...
    },
    gameState: { buildingPiles: overrides.buildingPiles || [[], [], [], []], /* ... */ },
  };
}
```

### Client: render helpers

Component tests wrap rendering in required providers (e.g.
`LanguageProvider`) via a helper:

```js
const renderComponent = (props = {}) => {
  return render(
    <LanguageProvider>
      <Component {...defaultProps} {...props} />
    </LanguageProvider>
  );
};
```

## Adding Tests for New Code

1. **Identify the module type** — game logic, coordinator handler,
   component, hook, or utility
2. **Find or create the test file** following the placement rules above
3. **Use existing patterns** — look at neighboring test files for
   helpers, mocks, and assertion style
4. **Test behavior, not implementation** — assert on outputs and side
   effects, not internal state
5. **Cover the happy path first**, then add edge cases and error
   conditions
6. **Commit tests atomically** — each `describe` block (or `it` when
   covering unrelated behavior) is its own commit, following the
   project's [commit guidelines](COMMIT_GUIDELINES.md)
