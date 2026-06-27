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

**Prefer one scope per commit, but the unit is the _concern_, not the scope.** If a change spans two areas because it is two concerns, split it. If it is **one** concern that happens to span areas — a feature added or removed across client and server, a rename across files — keep it one commit and list both scopes: `coordinator, game: …`. See [Atomic Commits](#atomic-commits).

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

The body explains **why** the change was made and **how** it addresses the
problem. The _what_ is already in the diff — a body that only restates the diff
has failed its job. This is the most important rule here: respect it on every
non-trivial commit.

- Lead with the **why**: what was wrong, or what goal the change serves
- Then the **how**: the approach, and context not obvious from the code
- Leave a blank line after the subject; wrap at 72 characters per line
- Use bullet points for multiple items

**Good** — gives the why and the how:

```
coordinator: preserve player on post-game disconnect

A post-game disconnect removed the player from the game, so a returning
player's session token no longer resolved and reconnect failed. Treat it
like a mid-game disconnect: keep the player in the game and broadcast
'playerDisconnected' so they can reconnect into the room.
```

**Bad** — just narrates the diff:

```
coordinator: preserve player on post-game disconnect

Stop calling removePlayer in handleDisconnect; emit playerDisconnected
instead.
```

_The diff already shows that line change. The body has to add what it can't:
why the old behaviour was wrong and what the new one restores._

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

**A commit is one complete, self-contained logical change** — the smallest change a reviewer can fully understand from its own diff, leaving the tree building and passing. Two gates dominate, and "smallest" is bounded by them:

1. **Self-contained** — the diff makes sense on its own. It never leans on code a sibling commit adds or removes, so a reviewer never has to open an adjacent commit to understand this one.
2. **Complete** — nothing is left dangling: no client event whose handler lives in another commit, no handler with no caller, no config constant or i18n key with no use, no behaviour without its tests.

Commits are written for reviewers — optimise for "understandable in isolation," not for line count. "When in doubt" is **not** a licence to split further; it asks "is each side still self-contained and complete?" If not, it is one commit.

### One concern, even across layers

A single logical change stays one commit even when it spans the stack:

- **Adding** a feature that needs a client emit, a server handler, and new state is **one commit** — the pieces are meaningless apart.
- **Removing** a feature removes **all** of it — client, server, game logic, translations, and its tests — in **one commit**. Splitting "remove the client events" from "remove the server handlers" yields two diffs that each look broken alone. That is over-splitting.
- A rename or an API-contract change touches caller and callee together, in one commit.

One commit may therefore span several scopes (list them: `game, client: remove rematch voting`), and several commits may share one scope. Atomicity is by **concern**, not by file, layer, or scope.

### Guidelines

- ✅ **Prefer the smallest commit that is still self-contained and complete**
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

### How to decide

Split a commit **only** along boundaries where each resulting piece is still self-contained and complete. Good boundaries are **independent concerns**:

- Separate validation from an unrelated logic change
- Separate a cleanup from new functionality it does not depend on
- A server concern and a client concern — **only when they work independently**, never the two halves of one feature

Bad boundaries split a single concern: by file, by layer (the data model / API / UI of one feature), or by side (the client / server of one feature). Those leave pieces that look broken alone — and force a reviewer to read neighbouring commits to make sense of the one in front of them.

Before splitting, ask:

1. Could a reviewer understand each piece from its diff alone?
2. Is each piece complete — nothing dangling, tests included?
3. Does each piece address a genuinely different concern?

Split only when all three are yes. There is no virtue in commit count — only in commits that each tell one complete, reviewable story.

## Changelog & Versioning

- The changelog is **hand-curated for end users** — grouped by release and written in user-facing language, not generated from commit subjects.
- Release versions are chosen deliberately by a human at release time, not inferred from commit subjects. See [Git Workflow](GIT_WORKFLOW.md) for the release process.
