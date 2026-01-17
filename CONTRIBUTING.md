# Contributing to CHouse UI

Thank you for your interest in contributing to CHouse UI! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/chouse-ui.git`
3. Create a branch with an appropriate prefix:
   - `feature/` - New features
   - `fix/` or `bugfix/` - Bug fixes
   - `docs/` - Documentation changes
   - `refactor/` - Code refactoring
   - `chore/` - Maintenance tasks
   - `test/` - Test additions or changes
   - `perf/` - Performance improvements
   
   Example: `git checkout -b fix/login-error` or `git checkout -b docs/update-readme`
4. Install dependencies: `bun install`

## Development Setup

See the [README.md](README.md) for detailed setup instructions. In brief:

```bash
# Install dependencies
bun install

# Start development servers
bun run dev
```

## Making Changes

1. Make your changes in your branch
2. Ensure your code follows the project's coding standards
3. Test your changes locally
4. Run linting: `bun run lint`
5. Run type checking: `bun run typecheck`

## Submitting Changes

1. Commit your changes with clear, descriptive messages
2. Push to your fork: `git push origin your-branch-name`
3. Open a Pull Request on GitHub
4. Fill out the PR template with details about your changes

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

If you're using AI coding assistants (like Cursor, GitHub Copilot, ChatGPT, etc.) to help with your contributions, **you must follow the project's coding rules**:

- **Before making changes**: Read and understand the rules in `.rules/CODE_CHANGES.md` (if available)
- **Before submitting**: Review your changes against `.rules/CODE_REVIEWER.md` (if available)
- Ensure your AI-generated code follows:
  - TypeScript strict mode guidelines
  - React best practices
  - Proper error handling and resource cleanup
  - Security and performance guidelines
  - Project structure and naming conventions

These rules ensure production-grade code quality and consistency. See the [README.md](README.md#for-ai-agents-and-contributors) for more details.

## Reporting Issues

When reporting bugs or requesting features:

- Use the issue templates if available
- Provide clear descriptions
- Include steps to reproduce (for bugs)
- Specify your environment (OS, Node/Bun version, etc.)

## Questions?

Feel free to open an issue for questions or discussions about the project.

Thank you for contributing!
