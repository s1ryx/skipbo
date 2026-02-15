# Code Standards

This document describes the formatting and linting rules enforced across
the codebase. All rules are applied automatically via pre-commit hooks
and verified in CI.

## Formatting (Prettier)

Configuration: [`.prettierrc`](../.prettierrc)

| Rule            | Value  | Notes                                      |
| --------------- | ------ | ------------------------------------------ |
| `singleQuote`   | `true` | Use `'single quotes'` for strings          |
| `semi`          | `true` | Always add semicolons                      |
| `printWidth`    | `100`  | Line wrap at 100 characters                |
| `trailingComma` | `es5`  | Trailing commas in objects/arrays (not fn) |
| `tabWidth`      | `2`    | 2-space indentation                        |

Files matched: `*.js`, `*.jsx`, `*.json`, `*.css`, `*.md`

Ignored paths are listed in [`.prettierignore`](../.prettierignore).

## Linting (ESLint)

### Client (`client/src/`)

Configuration: `eslintConfig` in [`client/package.json`](../client/package.json)

Extends `react-app` (Create React App defaults), plus:

| Rule             | Level  | Details                                       |
| ---------------- | ------ | --------------------------------------------- |
| `no-console`     | `warn` | Flags accidental `console.log` in components  |
| `no-unused-vars` | `warn` | Flags unused variables; `_` prefix is allowed |

### Server (`server/`)

Configuration: [`server/.eslintrc.json`](../server/.eslintrc.json)

Extends `eslint:recommended`, plus:

| Rule             | Level  | Details                                       |
| ---------------- | ------ | --------------------------------------------- |
| `no-unused-vars` | `warn` | Flags unused variables; `_` prefix is allowed |

`no-console` is intentionally omitted — the server uses `console.log`
for logging.

## Enforcement

### Pre-commit hook (local)

Powered by [husky](https://typicode.github.io/husky/) and
[lint-staged](https://github.com/lint-staged/lint-staged). On every
commit:

1. Prettier auto-formats staged files (formatting is applied, not just
   checked)
2. ESLint auto-fixes what it can and blocks the commit if any warnings
   remain (`--max-warnings=0`)

Configuration: `lint-staged` in [`package.json`](../package.json)

### CI (GitHub Actions)

The [lint workflow](../.github/workflows/lint.yml) runs on every push
and pull request. It checks:

1. `prettier --check` — fails if any file is not formatted
2. `eslint` for client and server — fails on any warning or error

PRs that fail CI cannot be merged.

## Running manually

```bash
# Format all files
npx prettier --write .

# Check formatting without modifying files
npx prettier --check .

# Lint client
cd client && npx eslint src/

# Lint server
cd server && npx eslint .

# Lint with auto-fix
cd client && npx eslint --fix src/
cd server && npx eslint --fix .
```

## Suppressing rules

When a rule must be bypassed for a valid reason:

```js
// Single line
// eslint-disable-next-line no-console
console.log('debug info');

// Block
/* eslint-disable no-console */
console.log('intentional');
console.log('also intentional');
/* eslint-enable no-console */
```

Use sparingly. If you find yourself suppressing the same rule
repeatedly, open an issue to discuss adjusting the rule.

## Editor integration

### VS Code

Install these extensions for live feedback:

- [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

Recommended workspace settings (`.vscode/settings.json`):

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "eslint.workingDirectories": ["client", "server"]
}
```
