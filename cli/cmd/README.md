# cmd

## Overview

Holds the CLI's executable entry points. There is one binary, `chouse`, whose `main` package only handles signals and build metadata and delegates everything else to `internal/cli`.

## Subdirectories & Boundaries

- chouse: [./chouse/README.md](./chouse/README.md) - `main` package for the `chouse` binary; signal-aware context, `-ldflags` build metadata, exit code from `cli.Run`.
