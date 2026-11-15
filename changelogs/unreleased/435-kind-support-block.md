type: minor

### Added
- **A kind the ClickHouse server cannot run is blocked up front** — Admin › Connections › ClickHouse login now asks the connection's server which kinds it can run and disables the others before anything is typed, with the server's version and what the kind needs: the role ceiling needs ClickHouse 24.4 or newer, a personal connection needs the `EXECUTE AS` statement. It asks the server itself, not a version list. The Linked ClickHouse users panel warns when the server can never be a personal connection.

### Changed
- **A switch to an unsupported kind is refused with one reason** — the API answers 422 `KIND_UNSUPPORTED_ON_SERVER` with the server's version and what is needed, instead of `IDENTITY_CHECK_FAILED` with a list of checks that each failed for the same cause.
