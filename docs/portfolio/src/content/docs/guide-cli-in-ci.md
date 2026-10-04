# Use the CLI in CI

Run checks and exports from a pipeline with the [`chouse` CLI](/docs/cli/). The pattern: a dedicated, scoped token in the CI secret store; JSON output; exit codes for control flow.

## 1. Create a token for the pipeline

**Preferences › Personal access tokens** → name it after the pipeline (`ci-nightly-report`), give it an expiry and only the scopes the job needs (e.g. `table:select`, `query:execute`, `data_health:view`). Store it as a CI secret, e.g. `CH_HOUSE_PAT`.

## 2. Install and sign in

```bash
curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash
echo "$CH_HOUSE_PAT" | chouse auth login --server https://chouse.corp --token-stdin
chouse status          # fails fast if the server is too old for this CLI
```

Behind an internal CA, add `--ca-cert ca.pem`. Pin the CLI version with `CHOUSE_VERSION=cli-v1.0.0` on the install line.

## 3. Write the steps

Piped output is JSON, so scripts can parse it:

```bash
# Export a report
chouse query -c prod -f reports/daily.sql --out daily.csv

# Fail the build while any data or pipeline incident is open
chouse incidents -c prod -o json | jq -e '.incidents | length == 0'

# Check one table before a downstream job runs
chouse health dataset analytics.daily_orders -c prod -o json

# Run a scheduled job now (changes things, so --yes is required without a terminal)
chouse scheduled run 4d2e… -c prod --yes
```

Anything that changes data fails closed without `--yes` in CI — before any request is sent.

## 4. Handle failures

| Exit code | Meaning | Usually |
| --- | --- | --- |
| 0 | Success | — |
| 2 | Usage error, or refused without `--yes` | Fix the command |
| 3 | Authentication | Token expired or revoked — rotate the secret |
| 4 | Permission | Add the scope named in the message to the token |
| 5 | Server error | Check the request id in the server logs |
| 6 | Network or timeout | Retry; reads already retry three times |

Errors print the server's request id; add `--debug` to trace every request (tokens are never printed).

## 5. Keep it tidy

One token per pipeline, rotated on a schedule (**Rotate token** keeps its name and scopes). Everything the token does is in the [audit log](/docs/audit-log/) under its owner.
