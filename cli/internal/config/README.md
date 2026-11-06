# config

## Overview

Package `config` resolves CLI settings with a strict precedence chain (flag > environment > credentials/config file > profile default) and persists named profiles. Secrets live only in the environment (`CH_HOUSE_PAT`) or the `0600` credentials file; the YAML config file never stores raw PATs.

## Interface

- `[config.go:EnvToken]` (`CH_HOUSE_PAT`), `EnvServer` (`CHOUSE_SERVER`), `EnvConnection`, `EnvProfile`, `EnvOutput`, `EnvCACert`, `EnvInsecure` - environment variable names.
- `[config.go:Profile]`, `[config.go:FileConfig]`, `[config.go:Credentials]` - on-disk YAML shapes for `config.yaml` and `credentials.yaml`.
- `[config.go:Flags]` / `[config.go:Resolve]` / `[config.go:Resolved]` - flag inputs, precedence resolution, and the result (`Server`, `Token`, `Connection`, `Profile`, `Output`, `CACert`, `InsecureSkipTLSVerify`).
- `[config.go:Resolved.RequireServer]`, `[config.go:Resolved.RequireToken]` - fail with setup guidance when unset.
- `[config.go:Dir]`, `[config.go:LoadFile]`, `[config.go:LoadCredentials]`.
- `[config.go:SaveCredentials]`, `[config.go:DeleteCredentials]`, `[config.go:SaveProfile]` with `[config.go:ProfileUpdate]`.
- `[config.go:SetProfileValue]`, `[config.go:ProfileValue]`, `[config.go:ProfileKeys]`, `[config.go:UseProfile]`, `[config.go:ListProfiles]` / `[config.go:ProfileInfo]`, `[config.go:DeleteProfile]`.
- `[config.go:MaskToken]` - safe display form of a PAT.

## Invariants

- The profile resolves as `--profile` > `CHOUSE_PROFILE` > `current_profile` > `default`; the token as `--token` > `CH_HOUSE_PAT` > credentials file `[config.go:Resolve]`.
- There is no default server: an unconfigured server resolves to `""` and `RequireServer` fails, so a PAT is never sent to a phantom localhost `[config.go:Resolved.RequireServer]`.
- `output` defaults to `auto`; the insecure-TLS switch is on only via flag or a truthy `CHOUSE_INSECURE_SKIP_TLS_VERIFY` (`1|true|yes|on`) `[config.go:Resolve]`, `[config.go:truthy]`.
- Tokens are not settable keys: `ProfileKeys` is `server`, `connection`, `output`, `ca_cert` only `[config.go:ProfileKeys]`.
- `MaskToken` never returns more than the first 7 and last 4 characters `[config.go:MaskToken]`.

## Side Effects

- Creates `~/.config/chouse` with mode `0700` when asked `[config.go:Dir]`.
- Writes `~/.config/chouse/credentials.yaml` and `config.yaml` with mode `0600` `[config.go:SaveCredentials]`, `[config.go:saveFile]`.
- Reads process environment variables listed above `[config.go:Resolve]`.

## Verification

- Run: `cd cli && go test ./internal/config/...`
