# explorer

## Overview

Data Explorer feature. All code lives under `components/` (sidebar tree, DDL modals) and its `ImportWizard/` subfolder.

## Subdirectories & Boundaries

- components: [components](./components/README.md) - Explorer sidebar (database tree plus pinned/recent/history/saved tabs) and modal dialogs for creating databases and tables, altering tables and uploading files; modal state comes from `useExplorerStore`, DDL goes through `@/hooks` mutations. Default exports, no barrel.
