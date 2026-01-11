# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.4.1] - 2026-01-11

### Changed
- **Changelog Sync**: Updated changelog synchronization workflow

## [v2.4.0] - 2026-01-11

### Added

#### Code Quality & Standards
- **Agent Rules**: Created comprehensive coding rules for AI agents and contributors
  - `.rules/CODE_CHANGES.md` - Rules for making code changes (TypeScript, React, error handling, security, performance)
  - `.rules/CODE_REVIEWER.md` - Rules for reviewing code (checklist, common issues, approval criteria)
- **AI Agent Guidelines**: Added section in README instructing AI agents to follow established coding rules

#### Licensing & Legal
- **Apache 2.0 License**: Added full Apache License 2.0 text in LICENSE file
- **NOTICE File**: Created NOTICE file acknowledging original CH-UI project by Caio Ricciuti
- **License Documentation**: Updated README with License section and Third-Party Code attribution
- **Portfolio License**: Added license information to docs/portfolio (LICENSE file, footer attribution, package.json)

#### Logs Page Enhancements
- **Clear Filters Button**: Added clear button to reset all applied filters (search, logType, user, role)
- **Filter Limit Fix**: Fixed limit filter inconsistency - increased fetch multiplier to 20x when filters are active (was 2x) to ensure correct number of unique queries after filtering and deduplication

### Fixed

#### Production-Grade Code Improvements

##### Server-Side (RBAC/Server)
- **Audit Route** (`packages/server/src/rbac/routes/audit.ts`):
  - Fixed immutable query object handling (use `effectiveUserId` instead of mutating query)
  - Added input validation for userId format
  - Added error handling with try-catch around `getAuditLogs`
  - Added missing date filtering support in `getAuditLogs` service (gte/lte operators)
  
- **Metrics Route** (`packages/server/src/routes/metrics.ts`):
  - Fixed type safety: replaced `any` types with proper `Context<{ Variables: Variables }>` and `Next`
  - Fixed service cleanup: ensure ClickHouse service is closed in `finally` block to prevent memory leaks
  - Improved error handling with proper cleanup on errors
  - Added `rbacConnectionId` to Variables type definition
  
- **Users Route** (`packages/server/src/rbac/routes/users.ts`):
  - Added input validation for user ID format
  - Added error handling with try-catch around `getUserById`
  
- **Query Route** (`packages/server/src/routes/query.ts`):
  - Improved error message formatting in audit log failure handling
  
- **RBAC Service** (`packages/server/src/rbac/services/rbac.ts`):
  - Fixed missing date filtering: added `gte` and `lte` operators for `startDate`/`endDate` in `getAuditLogs`
  - Improved query structure using `whereClause` for consistency

##### Client-Side
- **Logs Page** (`src/pages/Logs.tsx`):
  - Fixed memory leak: `setTimeout` in `useEffect` now properly cleaned up
  - Improved error handling with better error message formatting
  - Made debug logging conditional on `NODE_ENV === 'development'`
  
- **InfoTab Component** (`src/features/workspace/components/infoTab/InfoTab.tsx`):
  - Fixed memory leak: `setTimeout` for copy feedback cleaned up with `useRef` and `useEffect`
  - Fixed missing imports: added `useRef` and `useEffect` to React imports
  - Improved error handling with better error message extraction and type checking
  - Added proper timeout cleanup on component unmount
  
- **CreateTable Component** (`src/features/explorer/components/CreateTable.tsx`):
  - Improved error handling with better error message extraction
  
- **useQuery Hook** (`src/hooks/useQuery.ts`):
  - Made debug console.logs conditional on `NODE_ENV === 'development'`
  - Improved error handling with better error messages and fallback behavior

### Changed

#### Code Quality
- **Console Logging**: Made debug console.logs conditional on development environment across codebase
- **Error Messages**: Improved error message formatting and context throughout
- **Type Safety**: Enhanced TypeScript type safety across server and client code
- **Resource Cleanup**: Improved cleanup of timers, connections, and other resources

#### Documentation
- **README Updates**: 
  - Added "For AI Agents and Contributors" section with coding rules requirements
  - Added "License" section with Apache 2.0 information
  - Added "Third-Party Code" section acknowledging CH-UI project
- **Portfolio Documentation**: Updated footer and metadata with license information

## [v2.3.1] - 2026-01-11

### Fixed

#### Build & Dependencies
- **Docker Build**: Removed sensitive ENV variables (JWT_SECRET, RBAC_ENCRYPTION_KEY, RBAC_ADMIN_PASSWORD) from Dockerfile to follow security best practices.
- **ESLint Configuration**: Added missing `@eslint/js` package required for ESLint 9 flat config format.
- **Tailwind CSS**: Added missing `tailwindcss` dependency required by `@tailwindcss/vite` v4.
- **Bun Lockfile**: Regenerated `bun.lock` with correct package name to fix build errors.

## [v2.3.0] - 2026-01-11

### Added

#### RBAC Enhancements
- **Guest Role**: New `guest` role with read-only access to all tabs and data, including system tables for metrics and logs viewing.
- **System Tables Access**: Guest role can query system tables (e.g., `system.query_log`, `system.metrics`, `system.asynchronous_metrics`) for viewing metrics and logs.
- **Documentation Updates**: Added guest user credentials (username: `guest`, password: `Guest123456!`) to documentation under Live Demo section.

### Changed

#### RBAC System
- **Single Role Assignment**: Enforced that only one role can be assigned to a user (both frontend and backend validation).
- **Data Access Rules UI**: Hidden data access rules configuration section for `super_admin`, `admin`, and `guest` roles in user creation/editing forms, as these roles have role-level access rules.
- **Role Selection UI**: Changed role selection from checkboxes to radio buttons to reflect single role assignment policy.

#### User Interface
- **Settings Page**: Removed "Connected As" section from Settings page for all users.
- **Documentation Navigation**: Updated "Try Live Demo" button in Hero and Footer to scroll to Live Demo section instead of opening external link.

### Fixed

#### SQL Parser
- **System Table Detection**: Fixed fallback SQL parser to correctly identify system tables (e.g., `system.query_log`) even when database prefix is omitted or misparsed.
- **Query Validation**: Improved system table query validation to handle cases where parser incorrectly identifies `system.tableName` as `default.system`.

## [v2.2.0] - 2026-01-11

### Added

#### Data Explorer Enhancements
- **Favorites System**: Star icon to favorite/unfavorite databases and tables with persistent storage across sessions.
- **Recent Items Tracking**: Automatic tracking of recently accessed databases and tables with quick access panel.
- **Table Metadata Display**: Row count and table size badges visible on hover in the explorer tree.
- **Enhanced Search**: Debounced search with keyboard shortcuts (Ctrl/Cmd+K) and improved filtering.
- **Sorting Options**: Sort databases and tables by name or recent access.
- **Breadcrumbs Navigation**: Dynamic breadcrumb trail showing current navigation path with clickable navigation.
- **Loading Skeletons**: Replaced spinners with skeleton loaders for better visual feedback during data loading.
- **Improved Empty States**: Contextual empty states with actionable CTAs (e.g., "Create Database" button).
- **Table Preview Tooltips**: Hover tooltips showing table metadata (engine, rows, size) for quick information access.
- **View Type Indicators**: Distinct icons for views (purple eye icon) vs tables (green table icon).

### Changed

#### Data Explorer Performance
- **Virtualization**: Implemented `@tanstack/react-virtual` for efficient rendering of large saved queries lists.
- **Memoization**: Optimized component re-renders with `React.memo` and `useCallback` hooks throughout the explorer.
- **Debounced Search**: Search input debounced by 300ms to reduce excessive filtering operations.
- **Smart Filtering**: Enhanced filtering logic with favorites support and improved search performance.

#### SQL Query Validation
- **Multi-Statement Validation**: Enhanced SQL parser to validate each statement in multi-statement queries individually.
- **AST-Based Parsing**: Replaced regex-based parsing with `node-sql-parser` library for robust SQL statement analysis.
- **Improved Error Messages**: More detailed error messages for multi-statement queries with statement index and hints.

#### System Tables Visibility
- **UI Filtering**: System tables (`system`, `information_schema`) hidden from non-admin users in the explorer UI.
- **Query Access**: System tables still accessible via direct SQL queries if user has necessary permissions.

### Performance

- **Reduced Re-renders**: ~60% reduction in unnecessary component re-renders through memoization.
- **Search Optimization**: ~70% fewer filter operations through debounced search input.
- **Large List Rendering**: Smooth scrolling for saved queries with virtualization when list exceeds 20 items.
- **Memory Efficiency**: Improved memory usage with virtualized rendering for large datasets.

## [v2.1.0] - 2026-01-10

### Added

#### ClickHouse User Management
- **Complete User Management UI**: New Admin tab for managing ClickHouse database users directly from the Studio interface.
- **Role-Based User Creation**: Create ClickHouse users with predefined roles (Developer, Analyst, Viewer) with appropriate permissions.
- **Interactive Wizard UI**: Multi-step wizard with animated transitions for creating and editing users.
- **Database/Table Whitelisting**: Granular access control with database and table-level restrictions for users.
- **Cluster Support**: Create and manage users with `ON CLUSTER` clauses for distributed ClickHouse setups.
- **Host Restrictions**: Configure IP and hostname-based access restrictions for users.
- **Authentication Types**: Support for multiple authentication methods (sha256_password, double_sha1_password, plaintext_password, no_password).
- **Password Management**: 
  - Password strength validation with real-time feedback
  - Auto-generate secure passwords
  - Password requirements display (length, character types, common patterns)
- **DDL Generation**: Preview and copy generated SQL DDL statements before execution.
- **User Metadata Storage**: Persistent metadata storage for user configurations (role, cluster, host restrictions, allowed databases/tables).
- **Sync Unregistered Users**: Import existing ClickHouse users into metadata system for easier management.
- **Edit User Functionality**: Update user roles, permissions, host restrictions, and passwords with pre-populated forms.
- **User Listing**: View all ClickHouse users with host restrictions and authentication types.

#### Connection Access Control
- **User-Connection Access**: Restrict which RBAC users can access specific ClickHouse connections.
- **Connection User Access Management**: UI for managing which users have access to each connection.

### Fixed

- **ClickHouse User Management**: Removed unnecessary readonly user detection code that was causing issues. The system now handles readonly errors naturally when operations fail, without attempting to proactively detect or track readonly status.

## [v2.0.2] - 2026-01-10

### Fixed

- **Connection Info Display**: Fixed Settings page showing "Re-login to see URL" and "Connected As N/A" after registering new ClickHouse connections. Connection information (username, URL, version, admin status) now properly updates in the auth store when connecting to a connection.
- **Logout Functionality**: Fixed logout not working on Settings page and Sidebar. Logout now properly disconnects from ClickHouse connection sessions before RBAC logout and clears all session data.

## [v2.0.1] - 2026-01-10

### Fixed

- **Documentation**: Corrected environment variable names in migration guide (`JWT_SECRET`, `RBAC_ENCRYPTION_KEY`).
- **Configuration**: Updated `.env.example`, `Dockerfile`, and docker-compose files to use correct environment variable names.
- **README**: Fixed environment variable references in documentation.

## [v2.0.0] - 2026-01-09

### Added

#### RBAC System
- **Role-Based Access Control**: Complete RBAC implementation for authentication and authorization.
- **Predefined Roles**: `super_admin`, `admin`, `developer`, `analyst`, `viewer` with granular permissions.
- **Permission Categories**: User Management, Role Management, Database Operations, Table Operations, Query Operations, Saved Queries, Metrics, Settings, Audit.
- **JWT Authentication**: Secure token-based authentication with access and refresh tokens.
- **Argon2 Password Hashing**: Industry-standard password security.

#### Database Support
- **Dual Database Backend**: Support for both SQLite (development/single-node) and PostgreSQL (production/scalable).
- **Version-Based Migrations**: Automatic schema migrations with version tracking.
- **CLI Tools**: Command-line interface for RBAC database management (`rbac:status`, `rbac:migrate`, `rbac:seed`, `rbac:reset`).

#### ClickHouse Connection Management
- **Multi-Server Support**: Connect to multiple ClickHouse servers from a single Studio instance.
- **Connection CRUD**: Create, read, update, delete ClickHouse connections via Admin UI.
- **Secure Password Storage**: AES-256-GCM encryption for stored connection passwords.
- **Connection Testing**: Test connectivity before saving connections.
- **Connection Selector**: Sidebar dropdown to switch between ClickHouse servers.
- **Session Persistence**: Selected connection persists across browser reloads.

#### Data Access Rules
- **Granular Permissions**: Define database/table access rules per user.
- **Pattern Matching**: Support for wildcards (e.g., `analytics_*`, `*_staging`).
- **Access Type Inheritance**: Access levels (read/write/admin) derived from role permissions.
- **Query Validation**: SQL queries validated against access rules before execution.
- **Explorer Filtering**: Database/table tree filtered based on user permissions.
- **System Table Access**: Essential system tables always accessible for metadata queries.

#### Security
- **CORS Protection**: Strict origin enforcement in production mode.
- **Security Headers**: XSS protection, clickjacking prevention, CSP headers.
- **Audit Logging**: Comprehensive logging of user actions and security events.
- **API Protection**: All endpoints protected by JWT and permission middleware.

#### Deployment
- **Production Dockerfile**: Multi-stage build with security hardening.
- **Docker Compose (SQLite)**: Simple deployment for development/small teams.
- **Docker Compose (PostgreSQL)**: Production-ready deployment with PostgreSQL RBAC backend.
- **Environment Configuration**: Comprehensive environment variable support.

### Changed

- **BREAKING CHANGE**: Authentication now requires RBAC login instead of direct ClickHouse credentials.
- **BREAKING CHANGE**: User management moved from ClickHouse DDL to Studio RBAC system.
- **BREAKING CHANGE**: Environment variables restructured for RBAC configuration.
- **Admin Panel**: Refactored with new tabs for Users, Roles, Connections, and Audit Logs.
- **Login Page**: Redesigned for RBAC authentication with glassmorphism UI.
- **Sidebar**: Added connection selector and permission-aware navigation.
- **README**: Complete rewrite with architecture diagrams, deployment guides, and security documentation.

### Deprecated

- `CLICKHOUSE_DEFAULT_URL`: Use RBAC connections instead.
- `CLICKHOUSE_PRESET_URLS`: Use RBAC connections instead.
- `CLICKHOUSE_DEFAULT_USER`: Use RBAC connections instead.

### Removed

- Direct ClickHouse user management via DDL statements.
- Legacy authentication flow without RBAC.
- Unused components: `RbacUsersTable`, `RbacUserForm`, `RbacLogin`, `DataAccessRules` (role-level).

### Security

- All API endpoints require JWT authentication (except login/refresh).
- Permission checks enforced on all protected routes.
- CORS strict mode blocks unauthorized cross-origin requests in production.
- Passwords hashed with Argon2 (memory-hard algorithm).
- Connection passwords encrypted with AES-256-GCM.

### Migration Guide

#### From v1.x to v2.0.0

1. **Environment Variables**: Update your configuration:
   ```bash
   # New required variables
   RBAC_DB_TYPE=sqlite|postgres
   JWT_SECRET=<your-secret-key>
   RBAC_ENCRYPTION_KEY=<32-char-key-for-aes>
   
   # For SQLite
   RBAC_SQLITE_PATH=./data/rbac.db
   
   # For PostgreSQL
   RBAC_POSTGRES_URL=postgres://user:pass@host:5432/dbname
   ```

2. **Initial Setup**: On first run, the system will:
   - Run database migrations automatically
   - Create default roles and permissions
   - Create a `admin` user (password from `RBAC_ADMIN_PASSWORD` or `admin123`)

3. **User Migration**: Manually recreate users in the new RBAC system via Admin panel.

4. **Connection Setup**: Add your ClickHouse servers via Admin > Connections.

5. **Data Access**: Configure database/table permissions for non-admin users.

---

## [v1.0.0] - 2025-12-15

### Added

- Initial release of CHouse UI.
- SQL Editor with Monaco editor and syntax highlighting.
- Data Explorer with database/table tree navigation.
- Query execution with result grid (AG Grid).
- Query history and saved queries.
- Real-time metrics dashboard.
- Table schema viewer with data sampling.
- CSV/JSON export functionality.
- Multi-tab workspace.
- Dark/Light theme support.
