# Contributing to Skip-Bo Game

Thank you for your interest in contributing to the Skip-Bo Game project! This document provides guidelines for contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Message Guidelines](#commit-message-guidelines)
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
   This project follows the [git-flow branching model](docs/GIT_WORKFLOW.md). Keep your branch focused on a single feature or fix — see the [Git Workflow Guide](docs/GIT_WORKFLOW.md) for branch naming, merging strategy, and the full workflow.
3. **Install dependencies**:
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```
4. **Make your changes** following the code style guidelines
5. **Test your changes** thoroughly
6. **Commit your changes** following the [commit message guidelines](docs/COMMIT_GUIDELINES.md)
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

### Git-Flow Branching Workflow

This project follows the [git-flow branching model](https://nvie.com/posts/a-successful-git-branching-model/). See the [Git Workflow Guide](docs/GIT_WORKFLOW.md) for full details on branch types, merging strategy, and release management.

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. See the [Commit Guidelines](docs/COMMIT_GUIDELINES.md) for the full format reference, commit types, and atomic commit philosophy.

## Code Style

Code formatting and linting are enforced automatically. You do not need to memorize style rules — the tooling handles it.

- **Prettier** formats all JS, CSS, JSON, and Markdown files on commit
- **ESLint** catches code quality issues on commit and in CI
- A **pre-commit hook** (husky + lint-staged) runs both tools on staged files
- **GitHub Actions CI** blocks PRs that fail formatting or lint checks

Run checks manually before pushing if you prefer:

```bash
npx prettier --check .             # verify formatting
cd client && npx eslint src/       # lint client code
cd server && npx eslint .          # lint server code
```

See [docs/CODE_STANDARDS.md](docs/CODE_STANDARDS.md) for the full ruleset reference.

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

A pull request template is automatically provided when you open a PR on GitHub.

## Questions or Issues?

If you have questions or run into issues:

- Check the [README](README.md) for setup instructions
- Review existing [issues](https://github.com/s1ryx/skipbo/issues)
- Open a new issue if your problem isn't already reported

## License

By contributing to this project, you agree that your contributions fall under the terms defined in the [LICENSE](LICENSE) file.

---

Thank you for contributing to Skip-Bo! 🎮
