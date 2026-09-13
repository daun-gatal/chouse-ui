/**
 * Result caps and secret redaction (ADR 0013 §4).
 *
 * Every tool response passes through here before it reaches the model:
 *  - rows are capped (default 100),
 *  - cells are capped (default 2 KB),
 *  - the serialized payload is capped (default 200 KB) by halving arrays,
 *  - anything shaped like a secret is masked.
 *
 * The caps exist because a model has no business streaming a 10 GB SELECT
 * result into its context window, and redaction exists because a leaked
 * token or connection password must never echo back into a client log.
 */

export const DEFAULT_MAX_ROWS = 100;
export const DEFAULT_MAX_CELL_CHARS = 2048;
export const DEFAULT_MAX_BYTES = 200 * 1024;

const PAT_RE = /ch_pat_[A-Za-z0-9_-]{20,}/g;
const SECRET_KEY_RE = /(password|secret|token|apikey|api_key|jwt|credential)/i;

export interface CapsOptions {
  maxRows?: number;
  maxCellChars?: number;
  maxBytes?: number;
}

export interface CappedResult {
  data: unknown;
  truncated: boolean;
}

function maskSecret(value: string): string {
  const patStripped = value.replace(PAT_RE, "ch_pat_***");
  if (patStripped !== value) return patStripped;
  return value.length > 8 ? `${value.slice(0, 3)}***` : "***";
}

/** Walk a value and mask secret-shaped leaves. Returns a new object/array. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    if (PAT_RE.test(value)) return value.replace(PAT_RE, "ch_pat_***");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "string" && SECRET_KEY_RE.test(key)) {
        out[key] = maskSecret(entry);
      } else {
        out[key] = redactSecrets(entry);
      }
    }
    return out;
  }
  return value;
}

/** Cap a string cell to maxCellChars characters. */
function capCell(value: unknown, maxCellChars: number): unknown {
  if (typeof value === "string" && value.length > maxCellChars) {
    return `${value.slice(0, maxCellChars)}…`;
  }
  return value;
}

function capRows(value: unknown, maxRows: number, maxCellChars: number): { data: unknown; truncated: boolean } {
  if (Array.isArray(value)) {
    const truncated = value.length > maxRows;
    const rows = truncated ? value.slice(0, maxRows) : value;
    return {
      data: rows.map((row) => {
        if (Array.isArray(row)) return row.map((cell) => capCell(cell, maxCellChars));
        if (row !== null && typeof row === "object") {
          const out: Record<string, unknown> = {};
          for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
            out[key] = capCell(cell, maxCellChars);
          }
          return out;
        }
        return capCell(row, maxCellChars);
      }),
      truncated,
    };
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let truncated = false;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "rows" && Array.isArray(entry)) {
        const capped = capRows(entry, maxRows, maxCellChars);
        out[key] = capped.data;
        truncated = truncated || capped.truncated;
      } else {
        out[key] = capCell(entry, maxCellChars);
      }
    }
    return { data: out, truncated };
  }
  return { data: capCell(value, maxCellChars), truncated: false };
}

/**
 * Apply the caps and redaction, then shrink the serialized payload under
 * maxBytes by halving the top-level array (or truncating the final string)
 * until it fits. Deterministic and cheap — the caps are coarse by design.
 */
export function applyCaps(value: unknown, options?: CapsOptions): CappedResult {
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
  const maxCellChars = options?.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  const redacted = redactSecrets(value);
  let { data, truncated } = capRows(redacted, maxRows, maxCellChars);

  let serialized = JSON.stringify(data);
  while (serialized.length > maxBytes) {
    if (Array.isArray(data) && data.length > 1) {
      data = data.slice(0, Math.max(1, Math.floor(data.length / 2)));
      truncated = true;
      serialized = JSON.stringify(data);
      continue;
    }
    serialized = serialized.slice(0, maxBytes);
    data = { truncated: true, preview: serialized };
    truncated = true;
    break;
  }

  return { data, truncated };
}

/** Render a capped result as MCP text content. */
export function cappedJson(value: unknown, options?: CapsOptions): string {
  const { data, truncated } = applyCaps(value, options);
  if (truncated) {
    return JSON.stringify({ truncated: true, data }, null, 2);
  }
  return JSON.stringify(data, null, 2);
}
