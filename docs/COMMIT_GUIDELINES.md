# Commit Message Guidelines

> Part of the [project documentation](../README.md#documentation).
> See also: [Git Workflow](GIT_WORKFLOW.md) for branching model and PR process.

Every commit subject leads with a **scope** — the area of the code that changed — followed by an imperative description. The scope is mandatory. When you track changes, hunt a bug, or `git bisect`, the _area_ that changed is what you look for, and a clear description already conveys what kind of change it is. This is the convention long-lived projects like Git and the Linux kernel use. See the [rationale](https://sumnerevans.com/posts/software-engineering/stop-using-conventional-commits/).

## Format

```
<scope>: <subject>

<body>

<footer (optional)>
```

## Scope

The scope is the **subsystem** touched — an area of the project, not a single file — drawn from the structure. Keep this list in sync with [ARCHITECTURE.md](ARCHITECTURE.md):

| Scope         | Area                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `game`        | rules engine (`server/gameLogic.js`)                                                                   |
| `coordinator` | server orchestration & game lifecycle (`gameCoordinator.js`, `GameRepository.js`)                      |
| `session`     | connections & reconnection (`server/SessionManager.js`)                                                |
| `bots`        | bot players & scheduling (`server/BotManager.js`)                                                      |
| `ai`          | bot decision engine (`server/ai/*`)                                                                    |
| `transport`   | Socket.IO layer (`server/transport/`, `client/src/transport/`)                                         |
| `config`      | server constants & game config (`server/config.js`)                                                    |
| `ui`          | React components & view helpers (`client/src/components/*`, `utils/`)                                  |
| `client`      | client app — state, wiring, shell (`useGameConnection.js`, `messageHandlers.js`, `App.js`, `index.js`) |
| `i18n`        | translations (`client/src/i18n/`)                                                                      |
| `ci`          | GitHub Actions / automation                                                                            |
| `build`       | build config, packaging, dependencies                                                                  |
| `docs`        | documentation                                                                                          |
| `repo`        | top-level / meta (gitignore, license, lockfile, tooling)                                               |

This is the canonical list of areas, not an exhaustive file map — scope a change to the subsystem it serves. Small foundation files (`errors.js`, `logger.js`, server bootstrap) take the scope of whatever change touches them. **There is no `tests` scope:** test files take the scope of the code they exercise and ship in the same commit (see [Atomic Commits](#atomic-commits)).

**One scope per commit.** If a change spans two areas, that is usually a sign it should be two commits (see [Atomic Commits](#atomic-commits)). When a change genuinely belongs to two scopes, list both: `coordinator, game: …`.

## Subject Line

- **`<scope>:` is mandatory** and comes first.
- **Aim for 50 characters or fewer**, including the scope (72 is the hard limit).
- Use lowercase after the scope.
- No period at the end.
- Use imperative mood ("add" not "added" or "adds").
- Describe **what** the commit does; the _why_ goes in the body.

**Good examples:**

- `ui: prevent race condition in card selection`
- `coordinator: preserve player on post-game disconnect`
- `docs: update installation instructions`

**Bad examples:**

- `feat: add stuff` — typed, vague, no scope
- `Fixed bug.` — past tense, capitalised, trailing period, no scope
- `update code` — no scope, says nothing

## Body

- **Wrap at 72 characters per line**
- Leave a blank line after the subject
- Explain **why** the change was made and **how** it addresses the issue
- Use bullet points for multiple items
- Provide context that isn't obvious from the code

**Example:**

```
coordinator: preserve player on post-game disconnect

A post-game disconnect removed the player from the game, so a returning
player's session token no longer resolved and reconnect failed. Treat it
like a mid-game disconnect: keep the player in the game and broadcast
'playerDisconnected' so they can reconnect into the room.
```

## Footer (Optional)

Use the footer for:

- **Breaking changes**: `BREAKING CHANGE: description of the breaking change`
- **Issue references**: `Fixes #123`, `Closes #456`, `Relates to #789`

These are free-form notes for people reading the history.

**Example:**

```
client: redesign game state management

Move game state into a single reducer for predictable updates.

BREAKING CHANGE: The game state structure has changed. Existing saved
games will not be compatible with this version.

Fixes #42
Closes #56
```

## Atomic Commits

**Philosophy: Make commits as small as possible while keeping them atomic.**

Each commit should represent **one logical change** - the smallest possible change that:

- Makes sense on its own
- Could be understood in isolation
- Would compile and run successfully if checked out
- Addresses exactly one concern

**When in doubt, split it!** If you can split a commit into smaller pieces where each piece still works independently, you should.

### Guidelines

- ✅ **Prefer many small commits over fewer large commits**
- ✅ One bug fix per commit (split if fixing multiple issues)
- ✅ One feature per commit (split into sub-features if possible)
- ✅ Each commit should compile and run successfully
- ✅ **Tests ship with the code they cover** — same commit, so every commit passes
- ✅ Split by concern: separate logic changes from state resets
- ✅ Split by scope when changes are independent
- ❌ Don't mix unrelated changes
- ❌ Don't include WIP commits in pull requests
- ❌ Don't create large "fix multiple bugs" commits

### Tests ship with their code

A change and the tests that cover it go in the **same commit**, under that change's scope — never a separate test commit. This keeps every commit green: there is no transient state where the behaviour is untested or a new test fails against unimplemented code, so `git bisect` stays reliable. Backfilling tests for already-shipped code is scoped to the area under test (e.g. `ui: cover the quick-discard toggle`).

### Real-World Example: Splitting a Complex Fix

**❌ Too Large (19 lines in one commit):**

```
game: prevent double card dealing on restart

Add guards and clear arrays to prevent players from receiving
double cards when restarting a game.

Changes:
- Add gameStarted check to prevent restarting
- Clear player arrays before dealing
- Reset game flags
- Prevent duplicate players
```

_Problem: Mixes 4 independent fixes that could each work alone._

**✅ Properly Split (4 atomic commits):**

```
commit 1: game: reject a duplicate player in a room (+5 lines)
  - Check if player ID exists before adding
  - Works independently, prevents one specific issue

commit 2: game: reject restart of an in-progress game (+5 lines)
  - Add gameStarted guard in startGame()
  - Works independently, prevents different issue

commit 3: game: clear player arrays before dealing cards (+5 lines)
  - Reset stockpile, hand, discardPiles to empty arrays
  - Defensive programming, works on its own

commit 4: game: reset building piles and flags on start (+4 lines)
  - Reset buildingPiles, gameOver, winner to initial state
  - Completes state reset independently
```

_Each commit is minimal, focused, and independently functional. Several commits sharing a scope is fine — atomicity is by concern, not by scope._

**Benefits of splitting:**

- Each fix can be understood without reading the others
- Easy to review (5 lines vs 19 lines per commit)
- Can cherry-pick individual fixes if needed
- If one fix causes issues, can revert just that commit
- Clear git history shows exactly what changed when

### How to Split Commits

**By Concern:**

- Separate validation from logic changes
- Separate cleanup from new functionality
- Separate guards from state resets

**By Scope (when independent):**

- The server change under one scope (e.g. `game`)
- The client change under another (e.g. `ui`)
- Only if they can work independently

**By Layer:**

- Data model changes first
- API changes second
- UI changes last

**Ask yourself:**

1. Can this commit be split further?
2. Does each piece make sense alone?
3. Would each piece pass tests independently?

If yes to all three, split it!

**Remember:** There's no such thing as "too many commits" as long as each one is meaningful and atomic. Small commits are easier to:

- Review
- Understand
- Revert if needed
- Cherry-pick
- Debug (with `git bisect`)

## Changelog & Versioning

- The changelog is **hand-curated for end users** — grouped by release and written in user-facing language, not generated from commit subjects.
- Release versions are chosen deliberately by a human at release time, not inferred from commit subjects. See [Git Workflow](GIT_WORKFLOW.md) for the release process.
