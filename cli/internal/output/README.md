# output

## Overview

Package `output` renders one command result value in one of four presentations: an aligned `table` for terminals, `csv`, or the full unchanged value as `json`/`yaml`. The default `auto` picks `table` on a terminal and `json` when stdout is piped, so scripts get a machine format without asking for one.

## Interface

- `[output.go:Auto]`, `Table`, `CSV`, `JSON`, `YAML` - format names; `[output.go:Formats]` lists them for `--output` validation and completion.
- `[output.go:Resolve]` - `Resolve(requested string, terminal bool) (string, error)` turns `auto`/empty into `table` or `json`.
- `[output.go:Column]` - a table/CSV column: `Header`, dot-path `Path`, optional `Format func(any) string`.
- `[output.go:View]` - where rows live (`List` dot path) and which `Columns` to show; ignored by JSON/YAML.
- `[output.go:Options]` - `Format`, `NoHeaders`, `Wide`.
- `[output.go:Print]` - `Print(w io.Writer, value any, view View, opts Options) error`.
- `[output.go:Tabulate]` - headers and string cells for a value; `[output.go:Rows]` counts the rows a view selects.

## Invariants

- An unknown `--output` value is an error naming the accepted formats `[output.go:Resolve]`.
- JSON and YAML print the whole value regardless of `View`; JSON is indented and does not HTML-escape `[output.go:Print]`.
- YAML values are normalised through a JSON round-trip so structs, maps and numbers render consistently `[output.go:normalize]`.
- Auto-derived tables show at most 8 columns and truncate cells at 60 characters unless `Wide` is set `[output.go:maxAutoColumns]`, `[output.go:maxCellWidth]`.
- Integral floats below 1e15 render without a decimal point `[output.go:cell]`.

## Side Effects

- Writes only to the supplied `io.Writer` `[output.go:Print]`.

## Verification

- Run: `cd cli && go test ./internal/output/...`
