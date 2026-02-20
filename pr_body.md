## Description

This PR encompasses a comprehensive set of recent enhancements, bug fixes, and feature additions across the frontend and backend, including RBAC user deletion, navigation improvements, Import Wizard extensions, AI Optimizer updates, and UI polishes.

## Type of Change

- [x] Bug fix (non-breaking change which fixes an issue)
- [x] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [x] Documentation update
- [x] Code refactoring
- [x] Other: UI/UX improvements

## Related Issue

Closes #143

## Changes Made

- **RBAC**: Fixed User Deletion to perform a hard delete instead of soft delete.
- **Navigation**: Implemented URL-based tabbed navigation (`.../{page}/{tab-name}`) for the Monitoring and Admin pages.
- **UI Metrics**: Fixed the "Total Rows" format on the Home page to use compact number formatting.
- **Import Wizard**: Enhanced the wizard to support appending data to existing tables, mapping file columns, and adding descriptions/advanced settings during table creation.
- **AI Optimizer**: Implemented OpenAI-compatible provider support and prevented infinite optimization loops.
- **UI Polishing**: Refined the Create Table UI and Query Debugger error displays.
- **Documentation**: Synchronized environment variable documentation across `README.md`, `.env.example`, and `Dockerfile`.
- **Testing**: Fixed failing API client tests and added tests for AI Optimizer changes.

## Testing

- [x] I have tested this locally
- [x] I have added/updated tests
- [x] All existing tests pass

### Test Steps
1. Navigate to `/admin` and `/monitoring` to verify tab routing updates the URL and works correctly.
2. Check the Home page for correct formatting of the Total Rows metric.
3. Test the Import Wizard functionality (appending data and creating tables with advanced settings).
4. Run tests with `bun run test` (or similar) to ensure all tests pass.
5. Verify the AI Optimizer Debugger UI handles errors gracefully.

## Screenshots

<!-- N/A due to the breadth of the changes -->

## Checklist

- [x] My code follows the project's code style guidelines
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have updated the documentation accordingly (if applicable)
- [x] My changes generate no new warnings or errors
- [ ] I have checked for breaking changes and documented them (if applicable)
- [x] I have tested the changes in the relevant environment (development/production)

## Additional Notes

These changes consolidate multiple recent bug fixes and feature enhancements into a single release package.
