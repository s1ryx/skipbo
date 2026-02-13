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

This project follows the [git-flow branching model](https://nvie.com/posts/a-successful-git-branching-model/). See the [Git Workflow Guide](GIT_WORKFLOW.md) for full details on branch types, merging strategy, and release management.

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. See the [Commit Guidelines](COMMIT_GUIDELINES.md) for the full format reference, commit types, and atomic commit philosophy.

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

By contributing to this project, you agree that your contributions fall under the terms defined in the [LICENSE](../LICENSE) file.

---

Thank you for contributing to Skip-Bo! 🎮
