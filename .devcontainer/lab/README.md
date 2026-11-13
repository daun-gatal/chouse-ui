# .devcontainer/lab

## Overview

The CHouse UI lab: a private, disposable copy of CHouse UI with a ClickHouse
server, sample data and example content for every area. Visitors open it in
their own GitHub Codespace from the README badge, the landing page's "Run your
own lab" button or the docs page *Try the lab*. The same stack runs in CI
(`.github/workflows/lab.yml`) and on any machine with Docker. It runs the
**published** CHouse UI image and changes no app code. See ADR 0032
(`docs/adr/0032-codespaces-lab.md`).

## Interface

- `[devcontainer.json]` - the Codespaces definition: Ubuntu base image with docker-in-docker, a 2-CPU / 8 GB machine, port 5521 forwarded and opened in the browser, optional `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` secrets, `up.sh` on every start, `WELCOME.md` opened.
- `[up.sh]` - starts the lab and prints the sign-in banner. Inputs: `CHOUSE_IMAGE`, `CLICKHOUSE_IMAGE`, `LAB_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LAB_AI_MODEL`. Exit status is the loader's.
- `[compose.yml]` - project `chouse-lab`: services `chouse-ui`, `clickhouse`, `load`, and `seed` (profile `tools`, run on demand).
- `[load.sh]` - the query-load loop run by the `load` service.
- `[WELCOME.md]` - the visitor guide opened in the codespace.
- Subdirectory: [seed](./seed/README.md) - the loader, the showcase content and the smoke check.

## Invariants

- No fixed secrets: `up.sh` writes `.env` (mode 600, gitignored) with random `JWT_SECRET`, `RBAC_ENCRYPTION_KEY`, `RBAC_ENCRYPTION_SALT`, admin password and ClickHouse password on the first run, and `compose.yml` refuses to start without them (`${VAR:?}`) `[up.sh:rand_hex]`, `[compose.yml:JWT_SECRET]`.
- A leftover lab whose `.env` is gone is removed before a fresh start, because its encrypted data can't be read with new secrets `[up.sh:PROJECT]`.
- CORS is pinned to the lab's own origins: the codespace URL (or `LAB_URL`), `localhost:5521` and `127.0.0.1:5521`, rewritten on every run, never `*` `[up.sh:lab_url]`.
- AI keys pass through from the environment to the `seed` run only; they are never written to `.env` `[compose.yml:OPENAI_API_KEY]`.
- `up.sh` is safe to run again: secrets are reused and the loader skips anything that exists `[up.sh:compose]`.
- The load talks to ClickHouse directly, not through the CHouse API, so it is never rate limited or audited; every query carries a `lab:` log comment `[load.sh:ch]`.
- ClickHouse is pinned (`26.5-alpine`) and memory-capped for the 8 GB machine; `part_log` is on so Data can learn write patterns `[compose.yml:clickhouse_low_memory]`.

## Side Effects

- Docker: pulls the CHouse UI and ClickHouse images, creates the `chouse-lab` project with volumes `chouse-data` and `clickhouse-data`, and publishes port 5521.
- Files: `.devcontainer/lab/.env` and `.devcontainer/lab/.state/` (`seed.json`, `login.txt`, `banner.txt`), all gitignored.
- The `load` service writes about 500 rows to `shop.orders_raw` every 30 seconds.
- With an AI key, the visitor's provider is called (and bills the visitor) when they use AI features.

## Verification

- Run: `bunx vitest run .devcontainer/lab/seed` (unit tests for the loader and smoke check)
- Type-check: `bunx tsc -p .devcontainer/lab/seed/tsconfig.json`
- Whole stack (Docker): `bash .devcontainer/lab/up.sh && docker compose -p chouse-lab -f .devcontainer/lab/compose.yml run --rm -T seed /lab/smoke.ts`, then `docker compose -p chouse-lab down -v`; CI runs the same in `.github/workflows/lab.yml`.
