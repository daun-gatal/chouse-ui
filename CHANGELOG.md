# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [v2.11.0] - 2026-02-23

### Added

- **AI Chat Assistant**: Introduced a fully integrated AI-powered chat assistant for ClickHouse exploration and analysis.
  - **Floating Chat Bubble**: New floating `AiChatBubble` component accessible from every page via a persistent button. Opens a resizable chat window with a premium glassmorphic design.
  - **Multi-turn Conversations**: Supports threaded conversations with full history — create, switch, and delete threads from a collapsible sidebar.
  - **Live Tool Execution Panel**: Expandable "Thinking" panel shows each tool the AI calls in real-time, including parsed arguments and a brief result summary (e.g. "12 rows returned"). SQL args render in a scrollable `<pre>` block.
  - **Streaming Responses**: AI text streams token-by-token using Server-Sent Events (SSE) with a live cursor indicator.
  - **Markdown Rendering**: Full GFM support — tables, fenced `sql` code blocks with syntax highlighting, inline code, headers, and lists. Includes `preprocessMarkdown` to normalise literal `\n` sequences and collapse code fences inside table cells.
  - **AI Tools**: The assistant has access to 14 ClickHouse tools — `list_databases`, `list_tables`, `get_table_schema`, `get_table_ddl`, `get_table_sample`, `get_table_size`, `run_select_query`, `explain_query`, `analyze_query`, `optimize_query`, `search_columns`, `get_slow_queries`, `get_database_stats`, and `generate_query`.
  - **RBAC Protection**: AI Chat is gated behind `AI_CHAT` permission; only users with the permission can open and use the assistant.
  - **Thread Persistence**: Conversations and tool-call results are persisted to the RBAC metadata database, surviving page reloads and sessions.
  - **Escape Key Support & Accessibility**: Press `Esc` to close the chat window; `aria-label` added for screen readers.
  - **Retry & Fallback UX**: Error messages include a styled "Retry" button; an empty-response fallback message is shown when the AI returns no content.

## [v2.10.3] - 2026-02-21


### Added

- **New Monitoring Metrics**: Added 7 new metrics to the Metrics Dashboard aligned with ClickHouse system tables.
  - **Performance Tab**: CPU Usage (Cores), Data Throughput (Bytes), Write I/O (disk/filesystem bytes/sec).
  - **Merges Tab**: Merged Bytes Throughput, Delayed Inserts (backpressure indicator with wait time).
  - **System Tab**: Load Average (15min) history chart, ZooKeeper Transactions/sec, ZooKeeper Traffic (bytes sent/received).
- **Home Page Refresh Button**: Added a global refresh button to the Home page header for refreshing all dashboard data (system stats, databases, queries, favorites) with a 3-second cooldown and spin animation.
- **Full-Screen Mode**: Added global full-screen toggle to the Floating Dock using the native Browser Fullscreen API. Sidebar mode auto-switches to floating during full-screen for maximum content space. Toggle between `Maximize2`/`Minimize2` icons with ESC key support.
- **Dock Settings Popover**: Consolidated dock control buttons (auto-hide, orientation, dock mode, reset position) into a single `⚙` gear popover with labeled rows. Fullscreen and manual hide buttons remain inline. Redesigned auto-hide indicator to show current page icon/label with a pulsing connection dot.

### Changed

- **Home Page Layout**: Updated Home page to use full-width layout matching Admin, Monitoring, and Preference pages (removed `max-w-7xl` constraint).
- **Home Page Background**: Removed custom dark gradient background so the Home page inherits the same glass-style background as other pages.
- **Chart Y-Axis Formatting**: Improved value formatting for metrics with small decimal values (Cores, Load, Txn/s, Delayed) using adaptive precision instead of compact notation that rounded to zero.
- **Dock UX Improvements**: Increased auto-hide delay to 3.5s for better reliability, replaced Eye/EyeOff with Pin/PinOff icons for the auto-hide toggle, and removed keyboard shortcut labels (⌘1–⌘5) from dock tooltips.

### Fixed

- **ClickHouse Users Refresh Button**: Fixed "Check Connection" button on the ClickHouse Users tab doing nothing when no active session exists. The button now performs a server-side session check and provides feedback via toast notification.
- **Cache Bytes Calculation**: Fixed `cache_bytes` metric to correctly sum all in-memory cache types (mark cache, uncompressed cache, compiled expression cache, etc.) using `arraySum(COLUMNS('CurrentMetric_.*CacheBytes'))` instead of only `PrimaryIndexCacheBytes`.
- **System History Queries**: Fixed `getSystemMetricsHistory` to correctly query `system.metric_log` for `CurrentMetric_Query/Merge/PartMutation` and `system.asynchronous_metric_log` for `TotalPartsOfMergeTreeTables` (was incorrectly querying async log for all metrics).
- **Network History Metrics**: Updated `getNetworkMetricsHistory` to use `system.asynchronous_metric_log` with `LIKE` patterns for network send/receive bytes (matching ClickHouse monitoring dashboards), with fallback to `system.metric_log`.

### Security

- **Live Queries RBAC Privilege Escalation**: Fixed security issue where non-admin RBAC users with `live_queries:view` and `live_queries:kill` permissions could see and terminate queries belonging to admin and super_admin users. Non-admin users now only see their own queries. Added new `live_queries:kill_all` permission for admin-level kill privileges; the existing `live_queries:kill` permission now only allows killing own queries.

## [v2.10.2] - 2026-02-20

### Added

- **AI Query Optimizer Support**: Added support for OpenAI-compatible AI providers using the `@ai-sdk/openai-compatible` package (Issue #143).
  - Enables integration with self-hosted models via Ollama, LocalAI, Together AI, etc.
  - Added `AI_OPENAI_COMPATIBLE_HEADERS` for custom authentication headers support.
- **Import Wizard Append Feature**: Enhanced Import Wizard to support appending data to existing ClickHouse tables (Issue #147).
  - Users can select existing tables via dropdown mapping in "Append to Existing Table" mode.
  - Fetch target table schema and provide interactive Column Mapping.
  - Skip "Create Table" process when appending and explicitly match columns upon insertion.

### Changed

- **Import Wizard**: Enhanced the schema preview step with advanced table configuration options (Issue #146).
  - Admins can now configure Table Engine, Partition By, TTL Expression, and Table Comments directly before importing.
  - Added support for column-level descriptions and Sort Key (`ORDER BY`) toggles depending on the Engine.
- **Create Table UI**: Redesigned the Database Explorer's column definition interface (Issue #144).
  - Replaced single-row flex layouts with responsive, multi-row cards.
  - Added native toggles for `Nullable` types and input fields for `Default Value` and `Description`.
  - Integrated `ORDER BY` and primary key selection inside column cards with visual highlighting.

### Fixed

- **Server Stat Display**: Fixed `totalRows` statistic formatting issue on the Home page (Issue #148).
- **AI Query Debugger**: Added UI error handling to gracefully display API failure messages with a retry option in the Debug Query Dialog (Issue #145).

## [v2.10.1] - 2026-02-17

### Added

- **AI Query Debugger**:
  - Introduced AI-powered Query Debugger to automatically analyze and suggest fixes for failed SQL queries (Issue #138).
  - Added frontend support with a new `DebugQueryDialog`.
- **SQL Parser**:
  - Replaced legacy regex-based parsing with a full Abstract Syntax Tree (AST) parser using `node-sql-parser`.
  - Added support for Common Table Expressions (CTE) in SQL analysis.
  - Improved table and column extraction for complex queries.

### Changed

- **AI Query Optimizer**:
  - Improved robustness with specialized system prompts to prevent infinite optimization loops.
  - Enhanced permission checks for AI features (Optimizer and Debugger) to follow RBAC.
- **UI/UX Refinement**:
  - Optimized the Explain popup and tab by conditionally hiding the Analysis tab when the AI Optimizer is enabled.
  - Resolved "Double Icon" bug in `ExplainPopout`, `RoleFormDialog`, and `ExplainTab` by leveraging automatic icon rendering in the standardized `Alert` component.
  - Refined visuals for SQL editor and query optimization dialogs.
- **Documentation Standards**: Standardized screenshot guidelines and updated documentation with new visual assets for all major features (Issue #130).
- **Portfolio Enhancements**:
  - Enhanced gallery with marquee scroll for a smoother experience.
  - Updated Quick Start guides and Docker Compose configurations.
  - Fixed various SEO and meta-tag issues.
  - Refactored API client for better resilience.
  - Added global `auth:unauthorized` event for immediate redirection on session loss.
- **Server Performance**: Introduced `ClientManager` to pool ClickHouse connections, reducing overhead and improving stability.
- **Session Duration**: Increased session expiration duration from 15 minutes to 4 hours (Issue #128).
- **Portfolio UI**: Updated portfolio text to prioritize "UI" over "Interface" and added dynamic copyright years.
- **Connection Troubleshooting**:
  - Implemented "smart" connection probing to automatically check alternative hosts (`127.0.0.1`, `host.docker.internal`) when `localhost` fails with `ECONNREFUSED`.
  - Improved error messages to suggest actionable fixes for connection refusal issues.
  - Bypass `ClientManager` caching during connection tests to ensure fresh connection attempts.

### Fixed

- **Authentication Stability**: Fixed critical race conditions in token refresh logic that caused random logouts.
  - Implemented global concurrency lock for token refreshes.
  - Updated all server routes to correctly return `401 Unauthorized` instead of `403 Forbidden` for expired sessions, enabling automatic recovery.
- **Audit Log Snapshots**: Enhanced query history to use user snapshots from audit logs, ensuring correct user display even for deleted or modified accounts.
- **Explain Popout**: Fixed "Analysis" tab visibility to correctly respect AI Optimizer configuration (Issue #129).
- **Session Enforcement**: Fixed a bug where database sessions were hardcoded to 7 days, ignoring configuration (Issue #128).
- **CI/CD**: Fixed release triggers for Dockerfile changes and enabled concurrent job cancellation to prevent build redundancy.


## [v2.10.0] - 2026-02-15

### Added

- **AI Query Optimizer**: Integrated intelligent query optimization directly into the SQL Editor (Issue #115).
  - **Multi-Provider Support**: Supports OpenAI, Anthropic, Google Gemini, and HuggingFace models.
  - **Interactive Dialog**: Dedicated interface to optimize queries with custom prompts.
  - **Diff View**: Visual comparison between original and optimized SQL.
  - **Detailed Analysis**: Provides markdown-formatted explanations, performance summaries, and actionable tips.
  - **RBAC Protection**: Restricted to users with `AI_OPTIMIZE` permission.
- **Audit Log Export**: Added ability to export audit logs to CSV with comprehensive filtering options.
  - Supports filtering by Date Range, Action, Username, Email, and Status.
  - Export respects current active filters.


### Changed

- **Explain Tab Enhancements**: Refactored Explain tab to distinct view types (Plan, AST, Syntax, Pipeline).
- **RBAC Roles UI**: Improved role management interface with better permission grouping and visual feedback.
- **SQL Editor**: Added direct access to AI Optimizer and improved save functionality.
- **Audit Log Filters**: Enhanced Audit Logs page with granular filtering by Username, Email, and Status.
  - Added dynamic metadata fetching for filter dropdowns.
  - Improved status visualization (Success vs Failed).


### Fixed

- **Home Page Navigation**: Fixed issue where clicking Favorites, Recent items, or Saved Queries from a different connection would fail.
  - Filtered Favorites, Recent items, and Saved Queries in the Home page to only show those belonging to the currently active connection (Issue #125).
  - Prevents "table not found" errors by ensure context matches the selected item.
- **Data Access Display**: Fixed "Data Access" card in Preferences to correctly show "Full Global Access" for all admin users.
  - Previously only updated for super admins, now correctly reflects promoted admin status immediately.
- **Audit Log Logic**: Fixed backend filtering logic for audit logs.
  - Ensure filters for username, email, and status are correctly applied in listing, export, and pruning operations.


## [v2.9.2] - 2026-02-14

### Added

- **Preferences Page**: Completely redesigned user preferences interface with enhanced visual design.
  - **Profile Hero Section**: Large profile card displaying user avatar, display name, email, join date, and assigned roles with gradient styling.
  - **Identity & Access Card**: Shows username, RBAC ID, and session status with visual indicators.
  - **Connection Details Card**: Displays ClickHouse endpoint and version with copy-to-clipboard functionality.
  - **Data Access Card**: Collapsible hierarchical view of data access rules organized by connection and database with expand/collapse functionality.
  - **Functional Access Card**: Categorized display of all user permissions grouped by category (e.g., queries, databases, tables).
  - **Premium Glass Morphism Design**: Modern glassmorphic cards with backdrop blur, gradient accents, and smooth animations.
  - **Responsive Grid Layout**: 3-column grid layout that adapts to different screen sizes.

### Changed

- **Settings → Preferences Rename**: Renamed "Settings" page to "Preferences" throughout the application for better clarity.
  - Updated route from `/settings` to `/preferences` with backward compatibility redirect.
  - Changed navigation icon from `Settings` to `UserCog` in FloatingDock.
  - Updated navigation label from "Settings" to "Preferences".
  - Removed `SETTINGS_VIEW` permission requirement (now accessible to all authenticated users).
- **Admin Page Redesign**: Completely redesigned admin page with modern card-based tab navigation.
  - **Tab Cards**: Replaced traditional tab list with large, interactive tab cards showing icon, label, and description.
  - **Visual Feedback**: Added hover effects, active state indicators, and smooth animations for tab switching.
  - **Color-Coded Tabs**: Each tab has a unique color scheme (purple for Users, blue for Roles, cyan for Connections, indigo for ClickHouse Users, green for Audit).
  - **Improved Layout**: Better spacing, glassmorphic design, and visual hierarchy.
- **Home Page Layout Improvements**: Enhanced Quick Access and Saved Queries sections.
  - **Fixed Heights**: Set consistent height (450px) for Quick Access and Saved Queries cards.
  - **Scrollable Content**: Added overflow scrolling to handle large lists without breaking layout.
  - **Full List Display**: Removed arbitrary limits (previously showed only 6 items), now displays all items with scrolling.
  - **Better Flex Layout**: Improved flex container structure for proper content distribution.
- **Monitoring Page Consolidation**: Unified Live Queries, Logs, and Metrics into a single Monitoring page.
  - Added backward compatibility redirects from `/logs` and `/metrics` to `/monitoring`.
  - Streamlined navigation with single entry point for all monitoring features.
- **Typography Refinements**: Improved text styling across Preferences page.
  - Changed labels to bold semibold font for better readability.
  - Enhanced contrast with proper color hierarchy (white for values, gray for labels).
  - Improved badge styling with proper padding and border radius.

### Fixed

- **Query Analyzer Type Safety**: Improved type handling in query analyzer service.
  - Fixed potential type errors in query pattern matching.
  - Added proper null checks and type guards.
- **RBAC Auth Route**: Enhanced authentication route error handling.
  - Improved session validation logic.
  - Better error messages for authentication failures.
- **Connection Management UI**: Fixed layout issues in connection management component.
  - Improved responsive behavior.
  - Fixed button alignment and spacing.
- **ClickHouse Users Management**: Refined user management interface.
  - Better error handling for user operations.
  - Improved loading states and feedback.
- **Preferences Page Access**: Fixed `DataAccessCard` to correctly display admin access status for non-super-admin administrators (Issue #124).

### Removed

- **Settings Page**: Removed old Settings page (`src/pages/Settings.tsx`) in favor of new Preferences page.
  - Old Settings page had limited functionality and outdated design.
  - New Preferences page provides comprehensive user profile and access information.

## [v2.9.1] - 2026-02-13

### Added

- **Data Import Wizard**: Replaced the simple file upload with a comprehensive wizard (Issue #102).
  - **Schema Inference**: Automatically detects column names, types, and nullability from CSV, TSV, and JSON files.
  - **Interactive Editor**: Review and modify the inferred schema before import.
  - **Data Preview**: Visualize the dataset structure and sample values.
  - **Streaming Upload**: Efficiently handles large file uploads using streaming inserts.
  - **Progress Tracking**: Real-time status updates for table creation and data insertion.
- **Visual Query Explain Plan**: Added visual representation of query execution plans (Issue #101).
  - **Explain Tab**: New tab in SQL Editor to visualize the query plan.
  - **Interactive Graph**: Uses ReactFlow and Dagre for DAG visualization of query steps with execution order numbering.
  - **Tear-out Window**: Support for popping out the explain plan into a standalone window via button or drag-and-drop.
  - **JSON Output**: Supports `EXPLAIN JSON` for detailed plan analysis.
- **Collapsible Explorer Sidebar**: Added ability to collapse/expand the database explorer sidebar to maximize workspace.
- **Floating Dock Navigation**: Replaced traditional sidebar with a modern floating dock.
  - **Draggable Dock**: Move the navigation dock anywhere on screen with drag-and-drop.
  - **Orientation Toggle**: Switch between horizontal and vertical dock layouts.
  - **Auto-Hide**: Dock automatically hides after inactivity with smooth reveal on hover.
  - **Sidebar Mode**: Option to pin the dock as a fixed sidebar on the left edge.
  - **Preferences Sync**: Dock configuration (mode, orientation, position, auto-hide) persists to database for cross-device sync.

### Changed

- **Overview Page Redesign**: Completely redesigned home page with bento-style layout.
  - **Server Stats Cards**: At-a-glance view of databases, tables, total rows, storage, connections, and active queries.
  - **Connection Info Header**: Displays active connection name, ClickHouse version, and server uptime.
  - **Quick Actions**: One-click access to New Query, Import, Monitor, and Query History.
  - **Quick Access Section**: Tabbed view for favorites and recently visited tables/databases.
  - **Saved Queries Panel**: Easy access to saved queries with public/private badges.
  - **Recent Activity**: Grid view of recent query executions with status indicators.
  - **ClickHouse Resources**: Quick links to official documentation, SQL reference, and best practices.

## [v2.8.7] - 2026-02-08

### Added

- **System Metrics Tab**: Added a new "System" tab to the Metrics Dashboard (Issue #110).
  - Monitoring for Memory Usage (Resident vs Tracking).
  - Visualization of File Descriptor usage.
  - Detailed breakdown of ClickHouse Thread Pools (Global, Local, Background).
- **Network Metrics Tab**: Added a new "Network" tab to the Metrics Dashboard (Issue #110).
  - Real-time tracking of TCP, HTTP, and Interserver connections.
- **Enhanced Performance Tab**: Refactored Performance tab to focus on latency extremes.
  - Added "Max Latency" card to highlight worst-case performance.
  - Removed duplicate p95/p99 metrics (now available in the header).

### Changed

- **Metrics Unification**: Removed duplicate metrics (QPS, Latency p95/p99) from individual tabs to ensure a cleaner, zero-duplication interface.
- **Backend Optimization**: Optimized `getProductionMetrics` service to fetch new system and network metrics in parallel.

### Fixed

- **Live Queries User Display**: Fixed inconsistent user display in Live Queries (Issue #108).
  - Now displays the specific RBAC user (e.g., `alice`) instead of the generic database user (e.g., `default`).
  - Added tooltip to show both RBAC user and ClickHouse user details.
  - Ensures consistency with Query Log display.
- **SQL Results Interaction**: Fixed layout and scrolling issues in SQL Results (Issue #109).
  - **Sticky Header**: Re-enabled sticky header with refined "Dark Glass" styling for better readability.
  - **Column Freezing**: Disabled sticky first column to prevent layout breakage on horizontal scroll.
  - **Pagination**: Added client-side pagination with configurable page size (10-100 rows) for improved performance.
  - **Visuals**: Aligned background brightness with Data Sample section for a consistent aesthetic.

## [v2.8.6] - 2026-02-07

### Added

- **Sidebar User Menu Redesign**: Replaced the "Account" section with a unified, premium User Menu (Issue #105).
  - **Expandable Profile**: Expanded sidebar shows full profile details (Name/Email) to efficiently use space.
  - **Minimalist Icon**: Collapsed sidebar shows a clean, icon-only avatar with tooltip details.
  - **Dynamic Interactions**: Added hover effects for better visual feedback (Red gradient for logout).
  - **Direct Actions**: Simplified interaction model with intuitive logout controls.
- **Logout Confirmation**: Added a confirmation dialog to prevent accidental logouts.
  - Implemented in both the **Sidebar User Menu** and the **Settings Page**.
  - Standardized the confirmation message ("Are you sure you want to log out?") across the app.
- **Audit Log Pruning**: Added retention policy support for audit logs (Issue #97).
  - Users can now prune logs older than 7, 30, or 90 days.
  - Support for custom date pruning.
  - Consolidated deletion logic into a single `RbacAuditPruneDialog`.
  - "Delete Logs" now supports deleting based on current active filters.
- **Audit Log Enhancements**: Improved audit log accuracy and usability (Issue #99).
  - **User Snapshots**: Audit logs now snapshot user details (`username`, `email`, `displayName`) at the time of the event, ensuring historical data remains accurate even if users are deleted or modified.
  - **Enhanced UI**: Added explicit columns for Display Name, Username, and Email in the Audit Logs table, replacing the single "User" column.
  - **Improved Export**: CSV export now includes snapshot fields (`Username (Snapshot)`, `Email (Snapshot)`, `Display Name (Snapshot)`) for better reporting.
  - **Horizontal Scrolling**: Enabled horizontal scrolling for the audit logs table to prevent content truncation.

### Fixed

- **Sidebar Layout**: Optimized vertical space usage in the sidebar by grouping account actions.
- **User Management Actions**: Fixed issue where the "More options" menu was visible for users with no permissions to act on the target user (Issue #98).
  - Conditionally render the dropdown menu only when valid actions (Edit, Delete, Reset Password) are available.
  - Ensures cleaner UI for admins who cannot modify super admins or other protected users.
- **Logout Request Loop**: Fixed issue where clicking logout would trigger multiple requests to the logout endpoint, causing 429 errors.
  - Implemented singleton `BroadcastChannel` in `sessionCleanup` to prevent self-notification loops.
  - Added authentication check safeguard in `AppInit` to prevent redundant logout calls.
- **SET Command Syntax Error**: Fixed issue where `SET` commands were treated as queries, causing `FORMAT JSON` to be appended and resulting in syntax errors (Issue #100).
  - Added `SET` to the list of command patterns in `ClickHouseService` to ensure it's executed as a command without formatting.
- **API Client Resilience**: Fixed application crash when receiving non-JSON error responses (e.g., 429 Too Many Requests) (Issue #103).
  - Client now attempts to parse response as JSON and falls back to plain text if parsing fails.
  - Ensures graceful error handling for rate limits and other infrastructure-level errors.
- **Rate Limit Mitigation**: Mitigated frequent 429 "Too Many Requests" errors in production (Issue #104).
  - Relaxed server-side rate limits (Queries: 300/min, API: 1000/min).
  - Implemented client-side retry logic with exponential backoff for 429 responses.
  - Optimized `useSystemStats` polling interval to reduce server load.
- **Environment Configuration**: Fixed `bun run dev` not consistently loading `.env` variables.
  - Updated `dev` script to explicitly use `--env-file=.env` flag, ensuring correct environment loading.

## [v2.8.5] - 2026-02-03

### Added

- **RBAC-based Query Execution**: Strictly execute queries based on user permissions (Issue #94).
  - Backend now handles permission checks for specific SQL commands.
  - Ensures robust security enforcement at the API level.

### Changed

- **Metrics Dashboard Unification**: Unified Metrics dashboard visuals with the Overview page (Issue #93).
  - Updated cards to match Overview style (Total Rows, Tables).
  - Consistent iconography for better UX.

### Fixed

- **Execution Control**: Fixed issue where the Execute button remained accessible during a running query without kill permissions (Issue #92).
  - Prevents unauthorized users from attempting to stop or re-run queries indiscriminately.

## [v2.8.4] - 2026-02-01

### Added

- **Audit Log Cleanup**: Added ability to delete audit logs based on active filters (Issue #89).
  - New "Delete Logs" button in Audit Logs tab with confirmation summarize.
  - Secure backend endpoint `DELETE /api/rbac/audit` with support for filtering.
  - Configurable retention protection (`CHOUSE_AUDIT_LOG_RETENTION_DAYS`, default 365).
  - New permission `audit:delete` for controlling cleanup operations.
- **Audit Deletion Migration**: Migration `v1.9.0` ensures the new `audit:delete` permission is assigned to the `super_admin` role automatically.
- **Version Display**: Added CHouse UI version number to sidebar footer (Issue #87).
  - Version is always visible in the sidebar
  - Shows abbreviated version when sidebar is collapsed with full version in tooltip
  - Version is dynamically read from package.json at build time
- **Kill Query Button**: Added ability to terminate running queries directly from the SQL Editor (Issue #88).
  - New "Stop" button appears in the toolbar when a query is executing
  - Confirmation dialog prevents accidental query termination
  - Requires `LIVE_QUERIES_KILL` permission
  - Dynamically tracks query execution status via `queryId`

### Changed

- **Premium Popover Design**: Updated Date Range and Delete Logs popovers with `backdrop-blur-3xl` glassmorphism and refined dark aesthetics.
- **Date Range UX**: Simplified interaction and added quick-select presets for range selection.
- **Query Logs View**: Default view mode changed to Grid Only (Issue #80).
  - Removed table view option to simplify the interface
  - Removed view toggle buttons
  - Set grid view as the permanent display mode
- **Explorer Page Title**: Removed redundant 'Explore' title from Explorer page header (Issue #85).
  - The sidebar already identifies the page as 'Explorer'
  - Title now only appears as a breadcrumb when navigating to a database/table
  - Creates a cleaner interface with more space for actual content
- **SQL Editor Toolbar**: Complete redesign of the editor toolbar for better aesthetics and UX.
  - New modular control group with black styling and backdrop blur
  - Dynamic button hover states (Blue for Run, Red for Stop)
  - Icon-only "Run" and "Stop" buttons with tooltips for a cleaner, modern look
  - Integrated save status indicators and tooltips for all actions

### Fixed

- **Calendar Alignment & Visibility**: Fixed "Su MoTuWeThFrSa" alignment issues by syncing with `react-day-picker` v9 classes.
  - Implemented robust CSS Grid layout for perfect weekday and date centering.
  - Enabled `fixedWeeks` to ensure all dates are visible without height jumps.
- **Dynamic Page Titles**: Fixed browser tab title not updating when navigating between pages (Issue #84).
  - Added `PageTitleUpdater` component to manage titles globally
  - Titles now update dynamically (e.g., "CHouse UI | Overview", "CHouse UI | Monitoring")
  - Explorer page retains context-aware titles (database/table names)
- **Search Bar Layout**: Fixed layout shift issue where search bar would expand unpredictably (Issue #81).
  - Enforced stable width for search bar input container
- **Refresh Button UX**: Added visual feedback to the Refresh button on Overview page (Issue #82).
  - Button now shows disabled state and spinning icon while refreshing
  - Added visual confirmation that refresh action is in progress
- **Metrics Updates**: Fixed issue where Errors card and other metrics would not update when switching connections (Issue #83).
  - Updated React Query hooks (`useMetrics`, `useSystemStats`, etc.) to include connection ID in query keys
  - Ensures data is automatically refetched when active connection changes
- **Horizontal Scrolling**: Fixed issue where query result grids wouldn't scroll horizontally with many columns.
  - Added width constraints and overflow management to the results panel
  - Ensured AG Grid correctly fills the available container space


## [v2.8.3] - 2026-01-31

### Added

- **Connection management RBAC**: New permissions `connections:view`, `connections:edit`, and `connections:delete` to control access to the Connections tab and CRUD actions.
  - **Backend**: Permissions in schema and seed; migration 1.8.0 assigns them to `super_admin`; connection routes require appropriate permission per action.
  - **Frontend**: `CONNECTIONS_VIEW`, `CONNECTIONS_EDIT`, `CONNECTIONS_DELETE` in RBAC store; Admin tab visibility uses `connections:view`.

### Changed

- **Connection Management UI**: Edit and Delete actions are permission-gated.
  - Add Connection, Edit, and Activate/Deactivate require `connections:edit`.
  - Delete requires `connections:delete`.
  - Test and Manage Access remain available to users with `connections:view`.
- **Role cards**: Connection-related permissions are grouped under "Connections" instead of "Other" in the Roles table (`PERMISSION_CATEGORIES`).

## [v2.8.2] - 2026-01-31

### Removed

#### Set Default Connection Feature (Issue #64)
- **Remove Set Default Connection**: Removed the non-functional 'Set Default Connection' feature that was admin-only and didn't persist correctly after login.
  - Removed `setDefault` method from `RBACConnectionsApi` in `src/api/rbac.ts`
  - Removed `handleSetDefault` and "Set as Default" button from `ConnectionManagement/index.tsx`
  - Removed `setDefaultConnection` function from `packages/server/src/rbac/services/connections.ts`
  - Removed `PUT /connections/:id/default` endpoint from `packages/server/src/rbac/routes/connections.ts`
  - Removed related tests from `connections.test.ts`

### Changed

#### Metrics Page Improvements
- **Replace CPU Load with Read Rate**: Replaced the CPU Load metric in the Performance tab with "Read Rate" (bytes read per second), providing more meaningful performance insights.
  - Read Rate calculated from `system.query_log` ProfileEvents over the last 60 seconds
  - Added `read_rate` field to `ResourceMetrics` interface (backend and frontend)
  - Updated `getResourceMetrics` service to query read throughput data
- **Cache Performance Icon**: Changed Cache Performance section icon from `Cpu` to `Zap` for visual consistency.

#### Overview Page Improvements  
- **Replace CPU Load with Error Rate**: Replaced the unreliable CPU Load metric on the Overview page with "Errors (24h)" for better utility.
  - Shows count of failed queries in the last 24 hours from `useMetrics` hook
  - Conditional styling: green when no errors, red/amber when errors present
  - Displays "All clear" or "Check logs" subtext based on error count
- **Removed Unused Components**: Removed unused `ProgressBar` component from Home.tsx.

## [v2.8.1] - 2026-01-30

### Fixed

- **PostgreSQL migration 1.7.0**: Fixed failure when using PostgreSQL; the postgres driver expects string/Buffer for bind params, not `Date`. Use `createdAt.toISOString()` for the `created_at` column in the role-permissions INSERT (fixes "Received an instance of Date" error).

## [v2.8.0] - 2026-01-30

### Added

- **Live Query Management** (Issue #71): Admins can view and stop running ClickHouse queries from the UI.
  - **View**: New Live Queries page lists executing queries from `system.processes` (filtered to exclude internal queries).
  - **Control**: Kill running queries via UI with confirmation; requires `live_queries:kill` permission.
  - **Security**: Restricted via RBAC; new permissions `live_queries:view` and `live_queries:kill` (assigned to admin roles).
  - **Backend**: New `/api/live-queries` route (GET list, POST kill); audit logging for kill actions.
  - **Frontend**: `liveQueriesApi`, `useLiveQueries`, `useKillQuery`, `useLiveQueriesStats`; Monitoring/Live Queries pages and nav entry.
  - **Tests**: Server route tests (`live-queries.test.ts`), frontend API and hook tests, MSW handlers for live-queries.

- **Overview Largest Tables**: Top tables by size now use `system.tables` (non-system databases only) so the overview "Largest Tables" section is populated even when `system.parts` is empty (e.g. non-MergeTree tables or restricted environments).
  - **Tests**: `getTopTablesBySize` and GET `/metrics/top-tables` tests; `getTopTables` and `useTopTables` frontend tests; MSW handler for `/metrics/top-tables`.

### Fixed

- **Upload to `default` database**: Allowed `default` as a valid database name in SQL identifier validation so file uploads to the ClickHouse `default` database no longer fail with "Invalid identifier: default".
  - **Frontend**: Removed `default` from reserved keywords in `src/helpers/sqlUtils.ts`; added tests for `validateIdentifier('default')` and `escapeQualifiedIdentifier(['default', 'table'])`.
  - **Server**: Same change in `packages/server/src/utils/sqlIdentifier.ts` and tests.

### Testing

- Added and updated tests for Live Queries (server routes, API, hooks, `useLiveQueriesStats`).
- Added tests for top-tables API, `useTopTables` export, and metrics GET `/metrics/top-tables`.
- Added tests for `default` identifier and `escapeQualifiedIdentifier` with `default` database (frontend and server).

## [v2.7.6] - 2026-01-22

### Added

- **Saved Queries Deletion** (Issue #65): Added ability to delete saved queries directly from the Data Explorer UI.
  - Delete button (trash icon) on saved query items
  - Confirmation dialog to prevent accidental deletion
  - Permissions check (`SAVED_QUERIES_DELETE`)

### Fixed

- **Duplicate Connection Filters** (Issue #66): Fixed issue where the active connection name was duplicated in "Pinned", "Recent", and "Queries" filter dropdowns in Data Explorer.
- **Role Icon Consistency** (Issue #67): Fixed icon mismatch between Roles Table and Role Form Dialog.
  - Aligned icons for Super Admin and Admin roles across the application
  - Updated Custom Role icon to `🔐` (Lock with Key) for consistency in Create/Edit User forms
  - Added "User Count" display to Role Form Dialog to match the table view

## [v2.7.5] - 2026-01-18

### Added

#### Comprehensive Server Test Infrastructure
- **187 Unit Tests**: Comprehensive test coverage across server codebase (96.4% pass rate)
  - Services: 49 tests (RBAC, ClickHouse, JWT, passwords, etc.)
  - Middleware: 48 tests (CORS, error handling, SQL parsing, data access)
  - RBAC Core: 24 tests (DB initialization, auth middleware, schema)
  - Routes: 21 tests (config, explorer, metrics, query)
  - RBAC Routes: 45 tests (auth, users, roles, audit, etc.)

- **Isolated Test Runner**: Custom shell script (`scripts/test-isolated-server.sh`) for complete test isolation
  - Runs each test file independently to prevent mock leakage
  - Shows running success rate (e.g., "5/5 (100%)")
  - Color-coded output with pass/fail indicators
  - 100% test pass rate with isolated execution

- **CI Integration**: Automated testing in GitHub Actions workflow
  - Runs on every push/PR to main/develop branches
  - Validates TypeScript compilation
  - Executes full test suite with isolation
  - Ensures code quality before merging

- **Test Scripts**: Added npm scripts for different test scenarios
  - `test` - Run all tests (quick feedback)
  - `test:coverage` - Run with coverage reports
  - `test:isolated` - Run with complete isolation (for CI)
  - `typecheck` - TypeScript validation

### Fixed

- **Rate Limiter Configuration** (Issue #30): Fixed aggressive rate limiting causing 429 errors
  - Increased login attempts: 5 → 10 per 15 minutes
  - Increased query endpoints: 10 → 100 per minute
  - Increased general API: 100 → 300 per minute
  - Users no longer experience rate limit errors during normal usage

- **Type Safety Improvements** (Issue #31): Enhanced TypeScript type safety across server
  - All tests include proper type checking
  - Improved error handling with typed errors
  - Better IDE support with stricter types
  - Reduced runtime errors through compile-time validation

### Changed

#### Project Organization
- **Centralized Scripts**: Moved test scripts to `/scripts` directory for monorepo organization
  - Renamed to `test-isolated-server.sh` for clarity
  - Script auto-navigates to packages/server
  - Prepared structure for future frontend tests

#### Testing Infrastructure
- **Mock Isolation**: Tests run file-by-file to prevent mock leakage between test suites
- **Coverage Reporting**: Added Codecov integration for tracking test coverage over time
- **CI Workflow**: Updated to use isolated test runner for reliability

### Testing

- Created comprehensive test suite covering:
  - JWT token generation and verification
  - Password hashing and validation
  - RBAC middleware and permissions
  - Route authentication and authorization
  - Database initialization and migrations
  - SQL parsing and injection prevention
  - Error handling and formatting
  - CORS policy enforcement

### Documentation

- Added test execution instructions to development workflow
- Documented known test limitations (saved-queries mock issue)
- Updated CI/CD documentation with test integration details

## [v2.7.4] - 2026-01-18

### Added

- **Automatic Database Creation**: Added automatic database creation for PostgreSQL and SQLite metadata databases:
  - **SQLite**: Automatically creates the database directory and file if they don't exist
  - **PostgreSQL**: Automatically creates the database if it doesn't exist (requires `CREATEDB` privilege)
  - Eliminates the need for manual database setup during initial configuration
  - Graceful error handling with informative logging

- **Comprehensive Permission-Based UI Hiding**: All UI elements are now hidden based on user permissions:
  - **Metrics Page**: Advanced tabs (Performance, Storage, Merges, Errors) are hidden for users with only `METRICS_VIEW` permission
  - **Home/Overview Page**: Quick Actions section hides actions based on permissions (Explorer, Metrics, Logs, Admin)
  - **Explorer Page**: Database/table operation dropdowns show only actions user has permission for:
    - "New Database" requires `DB_CREATE`
    - "New Table" requires `TABLE_CREATE`
    - "Upload File" requires `TABLE_INSERT`
  - **Logs Page**: User/role filter dropdowns now check `QUERY_HISTORY_VIEW_ALL` permission (not just super admin)
  - **Saved Queries**: All saved query features are permission-gated:
    - DataExplorer "Queries" tab requires `SAVED_QUERIES_VIEW`
    - HomeTab saved queries section requires `SAVED_QUERIES_VIEW`
    - SqlEditor save button requires `SAVED_QUERIES_CREATE` or `SAVED_QUERIES_UPDATE`
  - Users can only see and access features they have permission for, improving security and UX

### Documentation

- Added PostgreSQL permission requirements to README with SQL examples for granting `CREATEDB` privilege
- Added troubleshooting entry for PostgreSQL permission issues

## [v2.7.3] - 2026-01-18

### Added

- **RBAC Permission Checks for All Pages**: Added proper RBAC permission checks for all application pages:
  - **Overview/Home Page**: Now requires admin role (consistent with sidebar visibility)
  - **Logs Page**: Requires `QUERY_HISTORY_VIEW` or `QUERY_HISTORY_VIEW_ALL` permission
  - **Explorer Page**: Requires `DB_VIEW` or `TABLE_VIEW` permission
  - **Settings Page**: Requires `SETTINGS_VIEW` permission
  - All pages now properly enforce RBAC permissions, redirecting unauthorized users appropriately

- **Role Form Dialog Enhancements**: Added Collapse/Expand All button in role creation/editing dialog:
  - Single toggle button that switches between "Expand All" and "Collapse All" based on current state
  - Makes it easier to navigate permission categories when managing roles
  - Button shows appropriate icon (ChevronsDown/ChevronsUp) based on state

### Fixed

- **Duplicate Icon in Alert**: Fixed duplicate AlertCircle icon in "At least one permission is required" alert message. The Alert component already includes an icon based on variant, so the manual icon was removed.

## [v2.7.2] - 2026-01-18

### Fixed

- **Super Admin System Role Modification**: Fixed bug where super admins were blocked from modifying system roles despite having the proper permissions. The service layer now respects the route-level permission check, allowing super admins to modify system roles (including the super_admin role itself). (Fixes #50)
- **GitHub Pages SPA Routing for Googlebot**: Fixed redirect errors for Googlebot smartphone crawler by adding automatic `404.html` file generation during build. GitHub Pages now properly serves the SPA for all routes, ensuring proper indexing without redirect errors. (Fixes Google Search Console redirect errors)

## [v2.7.1] - 2026-01-18

### Fixed

- **Role Permissions in Edit Mode**: Fixed bug where previously selected permissions were missing when editing a role. The issue was caused by a mismatch between permission names (returned by backend) and permission IDs (expected by frontend). Now correctly maps permission names to IDs when initializing the edit form. (Fixes #46)
- **Explorer Dropdown Menu Actions**: Fixed two related bugs in the Explorer page dropdown menu:
  - Clicking "New Query" no longer triggers "View Details" action. Added proper event propagation handling to prevent unintended side effects.
  - Clicking disabled menu items (due to missing permissions) no longer opens the info tab. Disabled items now properly prevent event propagation. (Fixes #47)

## [v2.7.0] - 2026-01-17

### Added

#### Role Management UI
- **Interactive Role Creation/Editing**: New beautiful UI dialog for creating and editing RBAC roles
  - Create custom roles with custom permissions
  - Edit custom roles (name, display name, description, permissions, default flag)
  - Edit predefined/system roles (display name, description, permissions - backend enforces system role protection)
  - Permission selection by category with search functionality
  - Select All/Deselect All permissions
  - Collapsible permission categories with visual feedback
  - Smooth animations using Framer Motion
  - Default role assignment with automatic flag management

### Fixed

- **Default Role Flag**: Fixed bug where assigning a custom role as default didn't remove the default flag from the previous default role. Now ensures only one role can be default at any given time with atomic operations.

### Changed

#### Legacy Authentication Removal
- **RBAC-Only Authentication**: Removed all legacy ClickHouse session-based authentication code
  - Deleted `packages/server/src/routes/auth.ts` (legacy auth routes)
  - Deleted `src/api/auth.ts` (legacy auth API client)
  - Deleted `packages/server/src/middleware/auth.ts` (legacy auth middleware)
  - All authentication now strictly uses RBAC, improving security and simplifying the codebase

#### UI/UX Enhancements
- **Consistent Button Styling**: All buttons in Admin page now use consistent styling (`variant="outline"` with unified className)
- **Dialog Layout Improvements**: Fixed padding and scrolling issues in all dialogs
  - Proper flexbox layout for scrollable content
  - Consistent padding structure (`px-6` for horizontal, `py-4`/`py-6` for vertical)
  - Fixed height dialogs (`h-[90vh]`) with proper overflow handling
- **Enhanced Visual Design**: Improved animations and visual hierarchy across role management components

### Removed

- **Legacy Authentication Code**: Complete removal of unused ClickHouse session-based authentication
  - Legacy auth routes, API client, and middleware removed
  - All routes now require RBAC authentication only

### Security

- **Strengthened Authentication**: Removal of legacy auth paths reduces attack surface
- **RBAC Enforcement**: All routes now strictly require RBAC authentication

### Code Quality

- **Console Logging**: All debug console.log statements in ClickHouseUsers component are now wrapped in `process.env.NODE_ENV === 'development'` checks
- **Code Review**: All changes reviewed against `.rules/CODE_CHANGES.md` and `.rules/CODE_REVIEWER.md`

## [v2.6.1] - 2026-01-16

### Security

#### Critical Security Fixes
- **SQL Injection Vulnerabilities (Issue #27)**: Fixed multiple SQL injection vulnerabilities across the codebase
  - Added SQL identifier validation and escaping utilities (`validateIdentifier`, `escapeIdentifier`, `escapeQualifiedIdentifier`)
  - Implemented column type validation against whitelist
  - Fixed SQL injection in file upload, database/table routes, ALTER TABLE operations, and query hooks
  - All user-provided identifiers (database, table, column names) are now validated and properly escaped before use in SQL queries

- **XSS Vulnerabilities (Issue #28)**: Fixed cross-site scripting vulnerabilities
  - Integrated DOMPurify for HTML sanitization across all components using `dangerouslySetInnerHTML`
  - Fixed XSS in `AgTable`, `SqlTab`, `ManualCreationForm`, and `ConfirmationDialog` components
  - Added security warnings about localStorage token storage risks
  - All HTML content is now sanitized before rendering to prevent script injection

- **Weak Encryption and Environment Validation (Issue #29)**: Strengthened encryption and added production validation
  - Replaced weak `scryptSync` with proper PBKDF2 key derivation (100,000 iterations)
  - Removed hardcoded salt - now requires `RBAC_ENCRYPTION_SALT` environment variable in production
  - Removed default JWT secret - now requires `JWT_SECRET` (minimum 32 characters) in production
  - Added startup validation that fails fast if required environment variables are missing
  - Fixed silent decryption failures to throw errors instead of logging and returning null

### Changed

#### Breaking Changes
- **Production Environment Variables**: The following environment variables are now **required** in production:
  - `JWT_SECRET` (minimum 32 characters, recommended 64+)
  - `RBAC_ENCRYPTION_KEY` (minimum 32 characters, recommended 64 hex characters)
  - `RBAC_ENCRYPTION_SALT` (exactly 64 hex characters)
  - Server will **fail to start** in production if these are not set, preventing deployment with weak defaults

#### Migration Notes
- Existing encrypted passwords may need to be re-encrypted if the encryption key changes
- All SQL identifiers are now validated and escaped, which may reject previously accepted invalid names
- HTML content is now sanitized, which may affect custom formatting in some edge cases

## [v2.6.0] - 2026-01-16

### Added

#### Saved Queries Migration to RBAC Database
- **RBAC-Based Storage**: Migrated saved queries from ClickHouse to RBAC metadata database (`rbac_saved_queries` table). Queries are now properly scoped by user with optional connection association.
- **Shareable Queries**: Saved queries can now be shared across connections. When `connectionId` is null, queries are accessible from any connection.
- **Connection Filter**: Added connection filter dropdown to Explorer page for filtering Saved Queries, Pinned items, and Recent items by connection.
- **Connection Names API**: New `/saved-queries/connections` endpoint to fetch unique connection names for filter dropdown.

#### Auto-Save Functionality
- **Real-Time Sync**: Saved queries now auto-save 2 seconds after user stops typing, similar to Google Docs.
- **Visual Status Indicators**: New status badges showing `Saving...`, `Saved`, `Unsaved`, and `Synced` states in the SQL editor.
- **Immediate Save**: Press `⌘S` to save immediately without waiting for auto-save delay.

#### Save As Functionality
- **Save As New Query**: Duplicate saved queries with "Save As..." option (`⇧⌘S` shortcut).
- **Duplicate Name Detection**: Warning shown when query name already exists.
- **Rename & Save**: Update query name through dedicated menu option.

#### Explorer Page Redesign
- **Tab-Based Navigation**: Replaced collapsible sections with clean tab navigation (Databases, Pinned, Recent, Queries).
- **Unified Search**: Context-aware search for each tab (databases/tables and saved queries).
- **Connection-Aware Filtering**: Filter Pinned, Recent, and Saved Queries by connection (current, all, or specific).
- **Polished Empty States**: Contextual empty states with helpful descriptions for each tab.
- **Animated Transitions**: Smooth tab transitions with Framer Motion.

### Changed

#### Database Schema
- **Saved Queries Table**: New `rbac_saved_queries` table with `userId`, `connectionId`, `connectionName`, `name`, `query`, `description`, `isPublic`, `createdAt`, `updatedAt` columns.
- **User Favorites/Recent Items**: Extended `rbac_user_favorites` and `rbac_user_recent_items` tables with `connectionId` and `connectionName` columns for connection-aware tracking.
- **Migrations**: Added v1.4.0, v1.5.0, v1.6.0 migrations for schema changes with proper `ON DELETE SET NULL` handling.

#### API Changes
- **Saved Queries Routes**: Refactored to use RBAC database instead of ClickHouse. Removed `/status`, `/activate`, `/deactivate` endpoints.
- **User Preferences Routes**: Extended favorites and recent items APIs to accept `connectionId` and `connectionName`.
- **Auth Store**: Added `activeConnectionId` and `activeConnectionName` to global state for connection-aware operations.

#### UI/UX Improvements
- **Consistent Colors**: Aligned Explorer page colors with global theme using `white/5` and `white/10` opacity values.
- **Reactive Favorites**: Pinned star now updates immediately without requiring page refresh.
- **Non-Clickable Title**: SQL editor title is now display-only; renaming available through dropdown menu.
- **Removed Pencil Icon**: Removed edit icon from SQL editor for cleaner interface.

### Fixed

- **Pinned Star Not Updating**: Fixed `TreeNode` component to subscribe directly to favorites array for reactive re-rendering.
- **Rename and Save Not Working**: Fixed `updateSavedQuery` to properly pass name parameter and invalidate query cache.
- **Saved Queries Not Refreshing**: Added proper React Query cache invalidation after save/update operations.
- **Count Display Issues**: Fixed messy count badges in Explorer tabs by using proper `tabular-nums` styling.
- **Color Inconsistency**: Removed custom gradients and aligned hover/background colors across Explorer page.
- **Connection Filter Scope**: Filter now correctly applies only to Pinned, Recent, and Queries tabs (not Databases, which is connection-specific).

### Removed

- **ActivateSavedQueries Component**: Removed admin component for enabling/disabling ClickHouse-based saved queries (feature now always available via RBAC).
- **ClickHouse Saved Queries**: Removed all ClickHouse-specific saved queries logic from `ClickHouseService`.
- **Legacy Status Checks**: Removed `useSavedQueriesStatus`, `useActivateSavedQueries`, `useDeactivateSavedQueries` hooks.

### Security

- **Ownership Validation**: Saved queries can only be updated/deleted by their owner (validated server-side).
- **User Scoping**: Queries are properly scoped by `userId` with optional public sharing.

## [v2.5.3] - 2026-01-15

### Fixed

- **Metrics Page Auto-Refresh**: Fixed metrics page not automatically refreshing when ClickHouse connection is switched. Metrics now automatically update when switching connections via the connection selector.
- **SQLite RBAC Migration**: Fixed SQLite syntax error during RBAC initialization caused by reserved keyword 'table' in `rbac_user_favorites` and `rbac_user_recent_items` tables. Column names are now properly quoted in SQLite migrations.
- **Explorer Auto-Refresh**: Fixed Explorer tab not automatically refreshing when connection changes. Explorer now listens to connection change events and automatically fetches databases and tables from the newly selected connection.
- **Database Creation with ON CLUSTER**: Fixed database creation to properly support `ON CLUSTER` statements for distributed ClickHouse setups. Removed incorrect condition that prevented cluster creation from working.

### Security

- **Hono Framework**: Upgraded Hono from 4.11.3 to 4.11.4 to address security vulnerability.

### Added

- **Database Cluster Support**: Added cluster selection UI to database creation dialog, matching table creation functionality. Users can now create databases on distributed ClickHouse clusters through the UI.

### Changed

- **Database Creation API**: Updated `CreateDatabase` component to use `createDatabase` API function instead of direct query execution, ensuring proper cluster parameter handling.

## [v2.5.2] - 2026-01-15

### Added

- **Release Announcements**: Automatic discussion announcement creation when new releases are published
  - Extracts release notes from CHANGELOG.md
  - Formats as announcement with installation instructions and resources
  - Posts to Announcements discussion category automatically

### Fixed

- **Release Workflow**: Improved release workflow to include automatic announcement generation

## [v2.5.1] - 2026-01-14

### Fixed

- **RBAC Migration**: Fixed syntax error in PostgreSQL `rbac_user_favorites` migration.
- **Logs Page Refresh**: Fixed logs page verification to correctly refresh when switching connections.
- **Connection Display**: Added connection name display in Logs page with improved matching logic and non-super-admin fallback.
- **Audit Logs Export**: Fixed export functionality to correctly handle blob responses and download files.

## [v2.5.0] - 2026-01-13

### Added

- **User Preferences System**: Migrated user preferences from `localStorage` to database-backed storage for cross-device persistence
  - Explorer preferences (favorites, recent tables, panel sizes, view modes)
  - Monaco editor settings (font size, word wrap, minimap, etc.)
  - Logs page preferences (filters, view mode, auto-refresh, pagination)
  - User Management preferences (page size, search, filters)
  - New REST API endpoints (`/api/rbac/user-preferences`)

### Fixed

- **Session Isolation**: Fixed users seeing other users' favorites, recent tables, and unauthorized data
- **Query Status Detection**: Fixed failed queries (`QueryStart` with exceptions, `ExceptionBeforeStart`) incorrectly showing as "running"
- **Logs Page Stats**: Fixed inconsistent statistics by using shared processing logic for filtering, deduplication, and stats calculation
- **Metrics Page Alignment**: Unified failed query counting logic between Logs and Metrics pages
- **RBAC User Mapping**: Improved query log to RBAC user mapping with optimized audit log fetching and wider timestamp matching
- **Cache Metrics Query**: Fixed `getCacheMetrics` to use `event` column instead of `metric` when querying `system.events`
- **Top Tables Query**: Fixed "ILLEGAL_AGGREGATION" error by removing nested aggregate functions and moving size formatting to application code
- **Connection Access Control**: Fixed basic admins seeing connections they're not assigned to
- **Tab Persistence**: Fixed table tabs persisting after role change or logout

### Changed

- **Logs Page**: Added "Failed (Before Start)" filter option, enhanced status detection for all failed query types
- **Metrics Page**: Unified failed query definition to include all exception types (`ExceptionWhileProcessing`, `ExceptionBeforeStart`, `QueryFinish`/`QueryStart` with exceptions)
- **Explorer Sidebar**: Set minimum width to 33% to prevent messy structure when resizing
- **Database Schema**: Added `rbac_user_preferences` table with migration support
- **Performance**: Optimized audit log fetching and implemented debouncing for preference updates

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
