# Git-Flow Branching Workflow

> Part of the [project documentation](../README.md#documentation).

This project follows the [git-flow branching model](https://nvie.com/posts/a-successful-git-branching-model/) for managing development and releases. Understanding this workflow is essential for contributing effectively.

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
git commit -m "feat: add game mode selection UI"
git commit -m "feat: implement new game mode logic"

# Push to origin for code review
git push -u origin feature/new-game-mode

# After review, merge to develop with --no-ff
# (--no-ff preserves branch history and groups related commits)
git checkout develop
git merge --no-ff feature/new-game-mode \
  -m "merge: feature/new-game-mode into develop

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
git merge --no-ff fix/reconnection-logic \
  -m "merge: fix/reconnection-logic into develop

<description of what the branch fixes>"
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
git merge --no-ff hotfix-1.2.1 \
  -m "merge: hotfix-1.2.1 into master"
git tag -s v1.2.1 -m "$(git log --format='- %s' v1.2.0..hotfix-1.2.1)"
git push origin master --tags

# Merge to develop with --no-ff
git checkout develop
git merge --no-ff hotfix-1.2.1 \
  -m "merge: hotfix-1.2.1 into develop"
git push origin develop

# Delete local and remote branch
git branch -d hotfix-1.2.1
git push origin --delete hotfix-1.2.1
```

**Special consideration**: If a release branch exists when creating a hotfix, merge the hotfix to the release branch instead of `develop`. The changes will propagate to `develop` when the release branch is merged back.

## Release Management

Release branches coordinate the transition from development to production. They provide a dedicated space for release preparation while allowing ongoing development to continue on `develop`.

**Release branches** (`release-*`):

- **Branch from**: `develop` (when ready for release)
- **Merge back to**: Both `master` AND `develop` (at completion)
- **Naming**: `release-X.Y` (e.g., `release-1.2`, `release-2.0`)
- **Purpose**: Prepare production releases (bug fixes, final polishing, then version bumping)
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

**Step 1: Create release branch from develop (WITHOUT version bump)**

**Important**: Do NOT bump the version yet. The version bump will be the last commit before merging to master.

```bash
# Ensure develop is up to date
git checkout develop
git pull origin develop

# Create release branch (version in branch name, but don't bump code yet)
git checkout -b release-1.2 develop

# Push for review and tracking
git push -u origin release-1.2
```

**Step 2: Release preparation (bug fixes only)**

During this phase, `develop` continues to receive new features for the next release, while the release branch focuses on stabilization through bug fixes only. No new features are allowed on the release branch — they go to `develop` for the next release.

```bash
# On release-1.2 branch: fix bugs found during testing
git commit -m "fix: correct score display rounding"
git commit -m "fix: adjust card animation timing"
git push origin release-1.2
```

Bug fixes stay on the release branch until the final merge to `develop` in Step 5. They will reach `develop` together with the version bump in a single merge commit.

**Step 3: Version bump as final commit**

When all bug fixes are complete and you're ready to release:

```bash
# On release-1.2 branch: bump version as the LAST commit
# Edit package.json, version files, etc.
git commit -m "chore: bump version to 1.2.0"
git push origin release-1.2
```

**Step 4: Merge to master and create tag**

```bash
# Merge to master with --no-ff (preserves branch history)
git checkout master
git pull origin master
git merge --no-ff release-1.2 \
  -m "merge: release-1.2 into master"

# Create signed tag with generated changelog from commits
git tag -s v1.2.0 -m "$(cat <<'EOF'
v1.2.0 - Release Title

## Features
$(git log --format='- %s' v1.1.0..release-1.2 | grep '^- feat:')

## Bug Fixes
$(git log --format='- %s' v1.1.0..release-1.2 | grep '^- fix:')

## Documentation
$(git log --format='- %s' v1.1.0..release-1.2 | grep '^- docs:')
EOF
)"

# Push master and tag
git push origin master
git push origin v1.2.0
```

**Alternative: Simplified automated tag**:

```bash
# Simple one-liner for tag with all commits
git tag -s v1.2.0 -m "$(git log --format='- %s' v1.1.0..release-1.2)"
```

**Alternative: Manual changelog** (if you need to edit):

```bash
# Generate changelog template
git log --format="- %s" v1.1.0..release-1.2 > release-notes.txt

# Edit manually
nano release-notes.txt

# Create tag from edited file
git tag -s v1.2.0 -F release-notes.txt
```

**Step 5: Merge release branch back to develop**

The release branch must be merged back into `develop` so that future releases also contain the bug fixes. This single merge brings all fixes and the version bump into `develop` and keeps `master` a direct ancestor of `develop`, ensuring clean merges for subsequent releases.

```bash
# Merge release to develop with --no-ff
git checkout develop
git merge --no-ff release-1.2 \
  -m "merge: release-1.2 into develop"
git push origin develop
```

**Step 6: Clean up release branch**

```bash
# Delete local and remote branch
git branch -d release-1.2
git push origin --delete release-1.2
```

**Release Branch Lifecycle Visualization**:

```
Time →

develop:  ---F1---F2-------------------------------M2---F3---
                   \                               /
release-1.2:        \---B1---B2---V (version bump)
                                   \
master:   --------------------------M1---v1.2.0 (tag)

F1, F2, F3 = Features (continue on develop during release)
B1, B2 = Bug fixes on release branch
V = Version bump (last commit on release branch)
M1 = Merge to master (creates production release)
M2 = Merge to develop (brings all fixes + version bump, keeps ancestry clean)
```

**Key Points**:

- **Version bump LAST**: Bump version as the final commit on the release branch
- **Single merge to develop**: All bug fixes reach `develop` in one merge at the end, keeping history clean
- **Always merge back**: The release branch must be merged to both `master` and `develop` — this keeps master as a direct ancestor of develop, ensuring clean merges for future releases
- Features continue being added to `develop` while release is being prepared
- Always use **--no-ff** when merging branches to preserve history and enable easy rollback
- Simple bug fixes (single commits) go directly on release branch, no dedicated fix branch needed
- Complex bugs requiring multiple commits use dedicated `fix/*` branches
- Always use **signed, annotated tags** (`git tag -s`) with changelogs generated from commit messages
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
- **Clean ancestry**: Merging release to both master and develop keeps master as ancestor of develop
- **Minimal merge noise**: One merge commit per release on develop, not one per bug fix
- **Code review**: Pushing branches enables collaboration and early bug detection
- **Clean history**: Single-commit bug fixes don't clutter history with unnecessary merge commits

For complete details on the original model, see the [git-flow article](https://nvie.com/posts/a-successful-git-branching-model/).
