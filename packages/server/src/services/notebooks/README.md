# Investigation Notebooks

## Overview
Investigation notebooks (ADR 0016 §7) shared by incidents and Doctor reports: AI findings, read-only query cells, notes, charts and action references.

## Interface
- `[store.ts:ensureNotebook]`, `[store.ts:getNotebook]`, `[store.ts:findByAttachment]`, `[store.ts:listCells]`, `[store.ts:addCell]`, `[store.ts:getCell]`, `[store.ts:updateCellContent]`, `[store.ts:deleteCell]`, `[store.ts:toMarkdown]`, `[store.ts:CELL_KINDS]`, `[store.ts:cellContentSchema]`.

## Invariants
- `[store.ts:addCell]` validates new cell content with `[store.ts:cellContentSchema]` against `[store.ts:CELL_KINDS]`.
- `[store.ts:updateCellContent]` stores the given JSON without validation; the notebooks route uses it to merge a `snapshot` into a cell (`[../../routes/notebooks.ts:updateCellContent]`).
- `[store.ts:toMarkdown]` prints a "Rows withheld" line for a query cell marked `snapshotWithheld`. The route decides which cells are marked, per reader (`[../../routes/notebooks.ts:cellsFor]`); the store returns every cell as saved.

## Side Effects
- Writes `notebooks`, `notebook_cells` (`[store.ts:ensureNotebook]`, `[store.ts:addCell]`, `[store.ts:updateCellContent]`, `[store.ts:deleteCell]`); `addCell` also bumps `notebooks.updated_at`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
