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

See the [Local Network Setup](README.md#local-network-setup-multiplayer-testing) section in the README for detailed instructions.

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

- `feat`: A new feature for the game/application itself
- `fix`: A bug fix
- `docs`: Documentation only changes
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `build`: Changes to build system, build scripts, automation tools, CI/CD
- `chore`: Maintenance tasks, dependency updates, configuration
- `perf`: Performance improvements
- `style`: Code style/formatting changes (no logic changes)

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

Each commit should represent **one logical change**:

- ✅ One bug fix per commit
- ✅ One feature per commit
- ✅ Group related changes together
- ✅ Each commit should compile and run successfully
- ❌ Don't mix unrelated changes
- ❌ Don't include WIP commits in pull requests

**Example of good atomic commits:**
```
commit 1: feat: add environment-based configuration
commit 2: build: add environment configuration examples
commit 3: docs: add local network setup guide
```

**Example of bad commits:**
```
commit 1: Fixed everything and added docs
commit 2: WIP
commit 3: More changes
```

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
- Check the [README](README.md) for setup instructions
- Review existing [issues](https://github.com/s1ryx/skipbo/issues)
- Open a new issue if your problem isn't already reported

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Skip-Bo! 🎮
