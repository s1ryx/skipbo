# Commit Message Guidelines

> Part of the [project documentation](../README.md#documentation).
> See also: [Git Workflow](GIT_WORKFLOW.md) for branching model and PR process.

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages. This ensures a clear and consistent commit history.

## Format

```
<type>: <subject>

<body>

<footer (optional)>
```

## Type

Choose the appropriate type for your commit:

- `feat`: New features or enhancements (new functionality, UI improvements, feature polish)
- `fix`: Bug fixes (correcting defects, fixing broken behavior)
- `docs`: Documentation changes only (README, guides, comments)
- `refactor`: Code restructuring without changing behavior (renaming, reorganizing)
- `test`: Test changes only (adding tests, updating test code)
- `build`: Build system changes (webpack, npm scripts, Docker, CI/CD)
- `chore`: Maintenance tasks (dependency updates, configuration, tooling)
- `perf`: Performance improvements (optimizations, efficiency)
- `style`: Code formatting only (prettier, linting, whitespace) - NOT CSS/UI styling

## Subject Line

- **Maximum 50 characters**
- Use lowercase after the type prefix
- No period at the end
- Use imperative mood ("add" not "added" or "adds")
- Describe **what** the commit does concisely

**Good examples:**

- `feat: add user authentication`
- `fix: prevent race condition in card selection`
- `docs: update installation instructions`

**Bad examples:**

- `Added some stuff`
- `Fixed bug.`
- `Updated the code`

## Body

- **Wrap at 72 characters per line**
- Leave a blank line after the subject
- Explain **why** the change was made and **how** it addresses the issue
- Use bullet points for multiple items
- Provide context that isn't obvious from the code

**Example:**

```
feat: add environment-based configuration for network play

Enable configuration via environment variables to support local network
multiplayer without code changes.

Client changes:
- Add REACT_APP_SERVER_URL environment variable support with localhost fallback

Server changes:
- Add HOST environment variable to configure bind address (default: 0.0.0.0)
- Add CORS_ORIGIN environment variable for CORS configuration (default: *)
- Update server.listen() to use configurable HOST
```

## Footer (Optional)

Use the footer for:

- **Breaking changes**: `BREAKING CHANGE: description of the breaking change`
- **Issue references**: `Fixes #123`, `Closes #456`, `Relates to #789`

**Example:**

```
feat: redesign game state management

Refactor game state to use Redux for better state predictability.

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
- ✅ Split by concern: separate logic changes from state resets
- ✅ Split by file when changes are independent
- ❌ Don't mix unrelated changes
- ❌ Don't include WIP commits in pull requests
- ❌ Don't create large "fix multiple bugs" commits

### Real-World Example: Splitting a Complex Fix

**❌ Too Large (19 lines in one commit):**

```
fix: prevent double card dealing on game restart

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
commit 1: fix: prevent duplicate players in same room (+5 lines)
  - Check if player ID exists before adding
  - Works independently, prevents one specific issue

commit 2: fix: prevent restarting already-started game (+5 lines)
  - Add gameStarted guard in startGame()
  - Works independently, prevents different issue

commit 3: fix: clear player arrays before dealing cards (+5 lines)
  - Reset stockpile, hand, discardPiles to empty arrays
  - Defensive programming, works on its own

commit 4: fix: reset building piles and game flags on start (+4 lines)
  - Reset buildingPiles, gameOver, winner to initial state
  - Completes state reset independently
```

_Each commit is minimal, focused, and independently functional._

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

**By File (when independent):**

- Client changes in one commit
- Server changes in another
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
