# Contributing to CHouse UI

Thank you for your interest in contributing to CHouse UI! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/chouse-ui.git`
3. Create a branch **from `preview`** (the integration branch; `main` only receives
   releases) with an appropriate prefix:
   - `feat/` - New features
   - `fix/` or `bugfix/` - Bug fixes
   - `docs/` - Documentation changes
   - `refactor/` - Code refactoring
   - `chore/` - Maintenance tasks
   - `test/` - Test additions or changes
   - `perf/` - Performance improvements
   
   Example: `git checkout -b fix/login-error origin/preview`
4. Install dependencies: `bun install && (cd packages/server && bun install)`

## Development Setup

See the [README.md](README.md) for detailed setup instructions. In brief:

```bash
# Install dependencies
bun install

# Start development servers
bun run dev
```

## Making Changes

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) and the `README.md` contract of the
   directory you are changing. Update that contract if you change its exports,
   rules or side effects.
2. Follow the coding standards in [AGENTS.md](AGENTS.md) and
   [`.rules/CODE_CHANGES.md`](.rules/CODE_CHANGES.md), and add tests for new logic.
3. For a user-visible change, add a changelog fragment in `changelogs/unreleased/`
   (see [its README](changelogs/unreleased/README.md)). Never edit `CHANGELOG.md`
   or version numbers.
4. Run the checks:

   ```bash
   bun run lint
   bun run typecheck && (cd packages/server && bun run typecheck)
   bunx vitest run
   ./scripts/test-isolated-server.sh
   bun run check:contracts
   ```

   `./scripts/verify-all.sh` runs the whole gate, including migrations (Docker).

## Submitting Changes

1. Commit your changes with clear, descriptive messages
2. Push to your fork: `git push origin your-branch-name`
3. Open a Pull Request **against `preview`**
4. Fill out the PR template with details about your changes. The full pre-PR
   checklist is [`.rules/PRE_PR.md`](.rules/PRE_PR.md)

## Types of Contributions

We welcome various types of contributions:

- **Bug Fixes** - Fix issues and bugs
- **New Features** - Add new functionality
- **Documentation** - Improve or add documentation
- **Code Refactoring** - Improve code structure without changing behavior
- **Performance** - Optimize code for better performance
- **Tests** - Add or improve test coverage
- **UI/UX Improvements** - Enhance user interface and experience

## Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic
- Ensure proper error handling
- Follow existing code patterns in the project

## Using AI Tools

If you're using AI coding assistants (like Cursor, Claude Code, GitHub Copilot, etc.) to help with your contributions, **you must follow the project's coding rules**:

- **Agent instructions**: [`AGENTS.md`](AGENTS.md) at the project root, the one file every agent reads (`CLAUDE.md` imports it)
- **Detailed coding rules**: [`.rules/CODE_CHANGES.md`](.rules/CODE_CHANGES.md)
- **Review checklist**: [`.rules/CODE_REVIEWER.md`](.rules/CODE_REVIEWER.md)
- **Before opening a PR**: [`.rules/PRE_PR.md`](.rules/PRE_PR.md)
- **Design work with the EGM skills**: [`.rules/EGM.md`](.rules/EGM.md)
- **Codebase map**: [`ARCHITECTURE.md`](ARCHITECTURE.md) and the `README.md` contract in each code directory

These rules ensure production-grade code quality and consistency.


## Reporting Issues

When reporting bugs or requesting features:

- Use the issue templates if available
- Provide clear descriptions
- Include steps to reproduce (for bugs)
- Specify your environment (OS, Node/Bun version, etc.)

## Questions?

Feel free to open an issue for questions or discussions about the project.

Thank you for contributing!
