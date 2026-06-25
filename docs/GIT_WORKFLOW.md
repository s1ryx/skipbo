# Git-Flow Branching Workflow

> Part of the [project documentation](../README.md#documentation).

This project uses a branching model based on [git-flow](https://nvie.com/posts/a-successful-git-branching-model/), with one deliberate refinement: after a release or hotfix is tagged on `master`, `master` is merged **back into `develop`** — rather than merging the supporting branch into `develop` a second time. This keeps `master` a true ancestor of `develop`, so the next release merges into `master` without phantom conflicts. Understanding this workflow is essential for contributing effectively.

![Git-Flow Branching Model](images/git-flow-model.png)
_Figure: Git-Flow branching model by Vincent Driessen, licensed under CC BY-SA. [Original source](https://nvie.com/posts/a-successful-git-branching-model/)_

**Code Review Process**: Unlike the strict git-flow model where feature branches remain local, we push all supporting branches to origin for code review before merging. This enables collaboration, catches bugs early, and provides visibility into ongoing work.

## Main Branches

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

## Supporting Branches

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
git commit -m "ui: add game mode selection"
git commit -m "game: implement new game mode logic"

# Push to origin for code review
git push -u origin feature/new-game-mode

# After review, merge to develop with --no-ff
# (--no-ff preserves branch history and groups related commits)
git checkout develop
git merge --no-ff feature/new-game-mode \
  -m "Merge branch 'feature/new-game-mode' into develop

<description of what the branch adds>"
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
git commit -m "ui: correct score display rounding"
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
git commit -m "client: add connection state tracking"
git commit -m "client: implement reconnection retry logic"
git commit -m "client: restore game state after reconnect"

# Push for code review
git push -u origin fix/reconnection-logic

# After review, merge with --no-ff (multiple commits benefit from grouping)
git checkout develop
git merge --no-ff fix/reconnection-logic \
  -m "Merge branch 'fix/reconnection-logic' into develop

<description of what the branch fixes>"
git push origin develop

# Delete branch
git branch -d fix/reconnection-logic
git push origin --delete fix/reconnection-logic
```

**Hotfix branches** (`hotfix/*`):

- **Branch from**: `master` (production code)
- **Merge back to**: `master` (tagged), then `master` → `develop`; if a release branch is open, also merge `master` into it
- **Naming**: `hotfix/critical-bug` or `hotfix-X.Y.Z` (e.g., `hotfix-1.2.1`)
- **Purpose**: Emergency fixes for critical production bugs that halt business operation or block progress
- **Lifetime**: Very short - only until the fix is complete
- **Creates**: A new patch version tag on master
- **Key difference**: Skips the normal release cycle for immediate deployment

**Workflow**:

```bash
# Create the hotfix branch from master and bump the patch version first
git checkout -b hotfix-1.2.1 master
# Edit package.json, version files, etc.
git commit -m "build: bump version to 1.2.1"

# Fix the critical bug
git commit -m "coordinator: prevent state corruption on disconnect"

# Push for visibility
git push -u origin hotfix-1.2.1

# Merge to master with --no-ff and tag with a hand-written changelog
git checkout master
git merge --no-ff hotfix-1.2.1 \
  -m "Merge branch 'hotfix-1.2.1' into master"
git tag -s v1.2.1 -m "$(cat <<'EOF'
v1.2.1

## Bug Fixes
- <user-facing summary of the fix>
EOF
)"
git push origin master --tags

# Merge master back into develop so develop gets the fix and stays
# a descendant of master
git checkout develop
git merge --no-ff master \
  -m "Merge branch 'master' into develop"
git push origin develop

# Delete local and remote branch
git branch -d hotfix-1.2.1
git push origin --delete hotfix-1.2.1
```

**Special consideration**: If a release branch is open when the hotfix lands, also merge `master` into that release branch (`git checkout release-X.Y && git merge --no-ff master`) so the in-flight release ships the fix. Both branches bumped the version (bump-first), so this merge conflicts on the version line — resolve it in favour of the release's version; the resolution lives in the merge commit, no extra commit needed. `develop` already has the fix from the `master` → `develop` merge above, and when the release later merges into `master` the hotfix commits are shared history, so only the new release work comes over — no duplication.

## Release Management

Release branches coordinate the transition from development to production. They provide a dedicated space for release preparation while allowing ongoing development to continue on `develop`.

**Release branches** (`release-*`):

- **Branch from**: `develop` (when ready for release)
- **Merge back to**: `master` (tagged), then `master` → `develop`
- **Naming**: `release-X.Y` (e.g., `release-1.2`, `release-2.0`)
- **Purpose**: Prepare production releases (version bump, then bug fixes and final polishing)
- **Allowed changes**: Only minor bug fixes and release metadata (no new features)
- **Lifetime**: From release preparation start until merged to master and tagged

**Version Numbering (SemVer)**:

All version tags follow [Semantic Versioning](https://semver.org/) (SemVer) format: `vMAJOR.MINOR.PATCH`

- **MAJOR** (v**X**.0.0): Incompatible API changes or breaking changes
- **MINOR** (v0.**X**.0): New features added in a backwards-compatible manner
- **PATCH** (v0.0.**X**): Backwards-compatible bug fixes

Examples:

- `v0.1.0` - Initial release with basic features
- `v0.2.0` - Added new gameplay feature (backwards-compatible)
- `v0.2.1` - Fixed bug in existing feature
- `v1.0.0` - First stable release or breaking change

**Complete Release Workflow**:

**Step 1: Create release branch from develop and bump the version**

Assign the release its version number as the first commit on the branch, so the branch — and anything deployed from it to staging — reports the version you are about to ship.

```bash
# Ensure develop is up to date
git checkout develop
git pull origin develop

# Create the release branch
git checkout -b release-1.2 develop

# Bump the version as the first commit
# Edit package.json, version files, etc.
git commit -m "build: bump version to 1.2.0"

# Push for review and tracking
git push -u origin release-1.2
```

**Step 2: Release preparation (bug fixes only)**

During this phase, `develop` continues to receive new features for the next release, while the release branch focuses on stabilization through bug fixes only. No new features are allowed on the release branch — they go to `develop` for the next release.

```bash
# On release-1.2 branch: fix bugs found during testing
git commit -m "ui: correct score display rounding"
git commit -m "ui: adjust card animation timing"
git push origin release-1.2
```

Bug fixes stay on the release branch until the release is merged and tagged on `master`. They reach `develop` when `master` is merged into `develop` in Step 4.

**Step 3: Merge to master and create tag**

```bash
# Merge to master with --no-ff (preserves branch history)
git checkout master
git pull origin master
git merge --no-ff release-1.2 \
  -m "Merge branch 'release-1.2' into master"

# Create a signed, annotated tag with a hand-written, user-facing changelog
git tag -s v1.2.0 -m "$(cat <<'EOF'
v1.2.0 - Release Title

## Features
- <user-facing summary of each notable feature>

## Bug Fixes
- <user-facing summary of each notable fix>
EOF
)"

# Push master and tag
git push origin master
git push origin v1.2.0
```

**Writing the changelog in a file** (handy for longer notes):

```bash
# Compose the notes by hand, grouped and written for end users
$EDITOR release-notes.txt

# Create the tag from the file
git tag -s v1.2.0 -F release-notes.txt
```

**Step 4: Merge master back into develop**

Merge `master` — which now holds the tagged release — back into `develop`. This brings the bug fixes and the version bump into `develop` and keeps `master` a direct ancestor of `develop`, so the next release merges into `master` without conflicts.

```bash
# Merge master into develop with --no-ff
git checkout develop
git merge --no-ff master \
  -m "Merge branch 'master' into develop"
git push origin develop
```

**Step 5: Clean up release branch**

```bash
# Delete local and remote branch
git branch -d release-1.2
git push origin --delete release-1.2
```

**Release Branch Lifecycle Visualization**:

```
Time →

develop:  ---F1---F2-------------------------------M2---F3---
                   \                              /
release-1.2:        \---V---B1---B2              /
                                   \            /
master:   --------------------------M1--v1.2.0-/

F1, F2, F3 = Features continuing on develop during the release
V          = Version bump (the first commit on the release branch)
B1, B2     = Bug fixes on the release branch
M1         = Merge release-1.2 -> master  (the production release, tagged v1.2.0)
M2         = Merge master -> develop       (carries the fixes + bump; keeps master an ancestor of develop)
```

**Key Points**:

- **Version bump FIRST**: Bump version as the first commit on the release branch, so staging reports the version you're shipping
- **Single merge to develop**: The fixes and version bump reach `develop` in one `master` → `develop` merge, keeping history clean
- **Merge master back**: After tagging the release on `master`, merge `master` into `develop` — this keeps master a direct ancestor of develop, ensuring conflict-free merges for future releases
- Features continue being added to `develop` while release is being prepared
- Always use **--no-ff** when merging branches to preserve history and enable easy rollback
- Simple bug fixes (single commits) go directly on release branch, no dedicated fix branch needed
- Complex bugs requiring multiple commits use dedicated `fix/*` branches
- Always use **signed, annotated tags** (`git tag -s`) with a hand-written, user-facing changelog
- Tags are not pushed automatically - use `git push origin v1.2.0` or `git push origin --tags`

**Keep branches focused**:

- Each branch should address exactly one feature, bug, or release
- If you discover unrelated issues while working, create a separate branch
- This makes code review easier and rollback simpler
- For simple bugs, skip the branch and commit directly

**Branch lifetime**:

- Supporting branches are temporary - always delete after merging (both local and remote)
- Keeps repository clean and navigation simple
- Completed work lives in develop or master, not in abandoned branches

**Why this model works**:

- **Clear separation**: Development isolated from production code
- **Parallel development**: Multiple features developed simultaneously without conflicts
- **Release control**: Master always represents production-ready state
- **Easy rollback**: Features can be reverted as a unit using merge commits
- **Hotfix capability**: Critical fixes can bypass normal development cycle
- **Release preparation**: Releases can be polished while development continues
- **Clean ancestry**: Merging `master` back into `develop` keeps master an ancestor of develop
- **Minimal merge noise**: One `master` → `develop` merge per release on develop, not one per bug fix
- **Code review**: Pushing branches enables collaboration and early bug detection
- **Clean history**: Single-commit bug fixes don't clutter history with unnecessary merge commits

For the base model this builds on, see Vincent Driessen's [git-flow article](https://nvie.com/posts/a-successful-git-branching-model/).
