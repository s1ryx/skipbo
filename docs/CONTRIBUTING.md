# Contributing to Skip-Bo Game

Thank you for your interest in contributing to the Skip-Bo Game project! This document provides guidelines for contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Tagging and Releases](#tagging-and-releases)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)

## Getting Started

1. **Fork the repository** and clone it locally
2. **Create a branch** for your contribution:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```
   **Important:** Keep your branch focused on a single feature or fix. Unrelated changes (like documentation updates, refactoring) should be on separate branches.

   This project follows the [git-flow branching model](https://nvie.com/posts/a-successful-git-branching-model/). Feature and fix branches exist only as long as the feature is in development, then merge back into `develop` and are deleted. Each branch should contain **only commits directly related to that specific feature or bug fix**. This focused approach provides several benefits:
   - **Easier code review**: Reviewers can understand the feature in isolation
   - **Cleaner history**: `git log` clearly shows what was added when
   - **Simpler rollback**: If a feature causes issues, all related commits can be reverted as a unit
   - **Better collaboration**: Team members can understand the scope at a glance

   If you discover unrelated issues or improvements while working on a feature, create a separate branch for them rather than mixing concerns.
3. **Install dependencies**:
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```
4. **Make your changes** following the code style guidelines
5. **Test your changes** thoroughly
6. **Commit your changes** following the commit message guidelines below
7. **Push to your fork** and create a pull request

## Development Workflow

### Running the Development Environment

**Server (with auto-reload):**
```bash
cd server
npm run dev
```

**Client:**
```bash
cd client
npm start
```

### Testing on Local Network

See the [Local Network Setup](../README.md#local-network-setup-multiplayer-testing) section in the README for detailed instructions.

### Git-Flow Branching Workflow

This project follows the [git-flow branching model](https://nvie.com/posts/a-successful-git-branching-model/) for managing development and releases. Understanding this workflow is essential for contributing effectively.

![Git-Flow Branching Model](images/git-flow-model.png)
*Figure: Git-Flow branching model by Vincent Driessen, licensed under CC BY-SA. [Original source](https://nvie.com/posts/a-successful-git-branching-model/)*

**Code Review Process**: Unlike the strict git-flow model where feature branches remain local, we push all supporting branches to origin for code review before merging. This enables collaboration, catches bugs early, and provides visibility into ongoing work.

#### Main Branches

The repository maintains two permanent branches with infinite lifetime:

**`master`**:
- Represents production-ready code
- The source code at HEAD always reflects a production-ready state
- Every commit is a new production release by definition
- Only receives merges from release and hotfix branches
- Every merge commit is tagged with a version number

**`develop`**:
- Integration branch for ongoing development
- Contains the latest delivered development changes for the next release
- Serves as the foundation for feature development
- Receives merges from feature, fix, release, and hotfix branches
- Also receives direct bug fix commits for simple issues

#### Supporting Branches

Supporting branches are temporary and serve specific purposes. They always have limited lifetimes and are deleted after merging.

**Feature branches** (`feature/*`):
- **Branch from**: `develop`
- **Merge back to**: `develop` only
- **Naming**: `feature/feature-name` (anything except `master`, `develop`, `release-*`, or `hotfix-*`)
- **Purpose**: Develop new features for upcoming releases
- **Lifetime**: Exists only during feature development
- **Scope**: Contains only commits related to that specific feature

**Workflow**:
```bash
# Create feature branch
git checkout -b feature/new-game-mode develop

# Develop with atomic commits
git commit -m "feat: add game mode selection UI"
git commit -m "feat: implement new game mode logic"

# Push to origin for code review
git push -u origin feature/new-game-mode

# After review, merge to develop with --no-ff
# (--no-ff preserves branch history and groups related commits)
git checkout develop
git merge --no-ff feature/new-game-mode
git push origin develop

# Delete local and remote branch
git branch -d feature/new-game-mode
git push origin --delete feature/new-game-mode
```

**Bug Fixes**:

Most bug fixes are simple enough to be committed directly without a dedicated branch:

**Small bugs (single commit)**:
```bash
# Fix directly on develop
git checkout develop
git commit -m "fix: correct score display rounding"
git push origin develop
```

**Fix branches** (`fix/*`) - for large bugs only:
- **Branch from**: `develop`
- **Merge back to**: `develop`
- **Naming**: `fix/complex-bug-description`
- **Purpose**: Fix complex, non-critical bugs that require multiple commits to resolve
- **When to use**: Only when a bug fix needs multiple commits or significant changes
- **Scope**: Contains only commits related to that specific bug fix
- **Note**: Use hotfix branches for critical production bugs that need immediate deployment

**Workflow for complex bugs**:
```bash
# Create fix branch for a complex bug requiring multiple commits
git checkout -b fix/reconnection-logic develop

# Fix with atomic commits
git commit -m "fix: add connection state tracking"
git commit -m "fix: implement reconnection retry logic"
git commit -m "fix: restore game state after reconnect"

# Push for code review
git push -u origin fix/reconnection-logic

# After review, merge with --no-ff (multiple commits benefit from grouping)
git checkout develop
git merge --no-ff fix/reconnection-logic
git push origin develop

# Delete branch
git branch -d fix/reconnection-logic
git push origin --delete fix/reconnection-logic
```

**Hotfix branches** (`hotfix/*`):
- **Branch from**: `master` (production code)
- **Merge back to**: Both `master` AND `develop` (or active release branch if one exists)
- **Naming**: `hotfix/critical-bug` or `hotfix-X.Y.Z` (e.g., `hotfix-1.2.1`)
- **Purpose**: Emergency fixes for critical production bugs that halt business operation or block progress
- **Lifetime**: Very short - only until the fix is complete
- **Creates**: A new patch version tag on master
- **Key difference**: Skips the normal release cycle for immediate deployment

**Workflow**:
```bash
# Create hotfix branch from master
git checkout -b hotfix-1.2.1 master

# Fix the critical bug first
git commit -m "fix: prevent game state corruption on disconnect"

# Push for visibility
git push -u origin hotfix-1.2.1

# Bump patch version (last commit before merging)
git commit -m "chore: bump version to 1.2.1"
git push origin hotfix-1.2.1

# Merge to master with --no-ff and create tag with generated changelog
git checkout master
git merge --no-ff hotfix-1.2.1
git tag -s v1.2.1 -m "$(git log --format='- %s' v1.2.0..hotfix-1.2.1)"
git push origin master --tags

# Merge to develop with --no-ff
git checkout develop
git merge --no-ff hotfix-1.2.1
git push origin develop

# Delete local and remote branch
git branch -d hotfix-1.2.1
git push origin --delete hotfix-1.2.1
```

**Special consideration**: If a release branch exists when creating a hotfix, merge the hotfix to the release branch instead of `develop`. The changes will propagate to `develop` when bug fixes from the release branch are continuously merged back.

#### Release Management

Release branches coordinate the transition from development to production. They provide a dedicated space for release preparation while allowing ongoing development to continue on `develop`.

**Release branches** (`release-*`):
- **Branch from**: `develop` (when ready for release)
- **Merge back to**: `master` (at completion) AND `develop` (continuously during preparation)
- **Naming**: `release-X.Y` (e.g., `release-1.2`, `release-2.0`)
- **Purpose**: Prepare production releases (bug fixes, final polishing, then version bumping)
- **Allowed changes**: Only minor bug fixes and release metadata (no new features)
- **Lifetime**: From release preparation start until merged to master and tagged

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages. This ensures a clear and consistent commit history.

### Format

```
<type>: <subject>

<body>

<footer (optional)>
```

### Type

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

### Subject Line

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

### Body

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

### Footer (Optional)

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

### Atomic Commits

**Philosophy: Make commits as small as possible while keeping them atomic.**

Each commit should represent **one logical change** - the smallest possible change that:
- Makes sense on its own
- Could be understood in isolation
- Would compile and run successfully if checked out
- Addresses exactly one concern

**When in doubt, split it!** If you can split a commit into smaller pieces where each piece still works independently, you should.

#### Guidelines

- ✅ **Prefer many small commits over fewer large commits**
- ✅ One bug fix per commit (split if fixing multiple issues)
- ✅ One feature per commit (split into sub-features if possible)
- ✅ Each commit should compile and run successfully
- ✅ Split by concern: separate logic changes from state resets
- ✅ Split by file when changes are independent
- ❌ Don't mix unrelated changes
- ❌ Don't include WIP commits in pull requests
- ❌ Don't create large "fix multiple bugs" commits

#### Real-World Example: Splitting a Complex Fix

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
*Problem: Mixes 4 independent fixes that could each work alone.*

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
*Each commit is minimal, focused, and independently functional.*

**Benefits of splitting:**
- Each fix can be understood without reading the others
- Easy to review (5 lines vs 19 lines per commit)
- Can cherry-pick individual fixes if needed
- If one fix causes issues, can revert just that commit
- Clear git history shows exactly what changed when

#### How to Split Commits

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

## Tagging and Releases

This project uses **Git tags** to mark release versions. Tags help track stable snapshots of the codebase and provide clear version history.

### Version Numbering (SemVer)

All version tags follow [Semantic Versioning](https://semver.org/) (SemVer) format: `vMAJOR.MINOR.PATCH`

- **MAJOR** (v**X**.0.0): Incompatible API changes or breaking changes
- **MINOR** (v0.**X**.0): New features added in a backwards-compatible manner
- **PATCH** (v0.0.**X**): Backwards-compatible bug fixes

**Examples:**
- `v0.1.0` - Initial release with basic features
- `v0.2.0` - Added new gameplay feature (backwards-compatible)
- `v0.2.1` - Fixed bug in existing feature
- `v1.0.0` - First stable release or breaking change

### Creating Tags

Tags should be **signed** and include a **changelog** generated from commit messages since the previous tag.

**Format:**
```bash
# Generate changelog from commit messages
git log --format="- %s" v0.1.0..HEAD

# Create signed tag with changelog
git tag -s v0.2.0 -F tag-message.txt
```

### Tag Message Format

Tag messages should include a changelog organized by commit type:

```
v0.2.0 - Feature Update

## Features
- Add player chat functionality
- Add sound effects for card plays

## Bug Fixes
- Fix race condition in turn handling

## Documentation
- Update README with new features
- Add troubleshooting guide

## Build System
- Update dependencies to latest versions
```

**Automated changelog generation:**
```bash
# Create organized changelog from commits
{
  echo "v0.2.0 - [Short Description]"
  echo ""
  echo "## Features"
  git log --format="- %s" v0.1.0..HEAD | grep "^- feat:"
  echo ""
  echo "## Bug Fixes"
  git log --format="- %s" v0.1.0..HEAD | grep "^- fix:"
  echo ""
  echo "## Documentation"
  git log --format="- %s" v0.1.0..HEAD | grep "^- docs:"
  echo ""
  echo "## Build System"
  git log --format="- %s" v0.1.0..HEAD | grep "^- build:"
} > tag-message.txt

# Review and edit the message
cat tag-message.txt

# Create the tag
git tag -s v0.2.0 -F tag-message.txt
```

### Pushing Tags

Tags are not pushed automatically with `git push`. Push them explicitly:

```bash
# Push a specific tag
git push origin v0.2.0

# Push all tags
git push --tags
```

### Tag Guidelines

- ✅ Always sign tags (`git tag -s`)
- ✅ Use SemVer format (`vX.Y.Z`)
- ✅ Include a complete changelog in the tag message
- ✅ Organize changelog by commit type (feat, fix, docs, etc.)
- ✅ Tag stable, tested commits only
- ❌ Don't tag work-in-progress or experimental code
- ❌ Don't create tags without changelog messages

## Code Style

### JavaScript/React

- Use **2 spaces** for indentation
- Use **camelCase** for variable and function names
- Use **PascalCase** for component names
- Add comments for complex logic
- Keep functions small and focused
- Avoid deep nesting

### File Organization

- Place components in `client/src/components/`
- Place game logic in `server/gameLogic.js`
- Keep related CSS files next to their components
- Use meaningful file and directory names

### Best Practices

- **Don't over-engineer**: Only make changes that are directly needed
- **Keep it simple**: Prefer clarity over cleverness
- **Avoid premature optimization**: Make it work, then make it fast
- **Test your changes**: Ensure your changes don't break existing functionality
- **Security first**: Never introduce security vulnerabilities (XSS, injection, etc.)

## Pull Request Process

1. **Ensure your code follows** the style guidelines
2. **Update documentation** if you've added or changed features
3. **Write clear commit messages** following the guidelines above
4. **Test thoroughly** before submitting
5. **Create a descriptive pull request**:
   - Explain what changes you made and why
   - Reference any related issues
   - Include screenshots for UI changes
   - List any breaking changes

### Pull Request Template

```markdown
## Description
Brief description of what this PR does

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #(issue number)

## Testing
Describe how you tested your changes

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] My code follows the project's style guidelines
- [ ] I have tested my changes thoroughly
- [ ] I have updated the documentation if needed
- [ ] My commits follow the commit message guidelines
- [ ] I have added tests if applicable
```

## Questions or Issues?

If you have questions or run into issues:
- Check the [README](../README.md) for setup instructions
- Review existing [issues](https://github.com/s1ryx/skipbo/issues)
- Open a new issue if your problem isn't already reported

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Skip-Bo! 🎮
