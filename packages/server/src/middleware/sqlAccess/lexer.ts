/**
 * A small ClickHouse-compatible lexer for the access check (ADR 0030 §3, §5).
 *
 * It does not parse — ClickHouse does that. It exists to see what the
 * `EXPLAIN AST` printout can't show: quoted names that could forge or hide tree
 * lines, the object kind after CREATE/DROP, CTE names, and the words a hidden
 * part of a statement (INSERT data, a WINDOW body) could use to read a table.
 *
 * It follows ClickHouse's lexer where that matters: `--` and `#` line
 * comments, nested block comments, `'…'` strings with `\` and `''` escapes,
 * `"…"` and `` `…` `` names with doubled-quote and `\` escapes, and `$tag$…$tag$`
 * heredoc strings. Anything it can't close is an error, so the caller refuses
 * the statement.
 */

export type TokenKind = "word" | "quotedName" | "string" | "number" | "symbol";

export interface Token {
  kind: TokenKind;
  /** The word, the unescaped name or string, the number or the symbol. */
  value: string;
  /** Offset of the token's first character in the input. */
  start: number;
}

export type LexResult =
  | {
      ok: true;
      tokens: Token[];
      /** Offset where raw `INSERT … FORMAT <name>` data begins; the text before it is the whole statement. */
      dataStart?: number;
    }
  | { ok: false; reason: string };

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/** Read a quoted run starting at `i` (on the opening quote). Returns the unescaped value and the index after it. */
function readQuoted(sql: string, i: number, quote: string): { value: string; end: number } | null {
  let value = "";
  let j = i + 1;
  while (j < sql.length) {
    const ch = sql[j];
    if (ch === "\\") {
      if (j + 1 >= sql.length) return null;
      value += sql[j + 1];
      j += 2;
      continue;
    }
    if (ch === quote) {
      if (sql[j + 1] === quote) {
        value += quote;
        j += 2;
        continue;
      }
      return { value, end: j + 1 };
    }
    value += ch;
    j++;
  }
  return null;
}

/**
 * `INSERT … FORMAT <name>` where the rest of the text is raw data (CSV, TSV,
 * JSONEachRow, …). That data is never evaluated as SQL, so lexing stops there;
 * `Values` data is SQL expressions and is lexed like the rest.
 */
function insertDataStarts(tokens: Token[], depth: number): boolean {
  if (depth !== 0 || tokens.length < 3) return false;
  const name = tokens[tokens.length - 1];
  const format = tokens[tokens.length - 2];
  const first = tokens.find((t) => t.kind === "word");
  return (
    first?.value.toUpperCase() === "INSERT" &&
    format.kind === "word" && format.value.toUpperCase() === "FORMAT" &&
    name.kind === "word" && name.value.toUpperCase() !== "VALUES"
  );
}

export function lex(sql: string): LexResult {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Line comments: -- and #.
    if ((ch === "-" && next === "-") || ch === "#") {
      const eol = sql.indexOf("\n", i);
      i = eol === -1 ? sql.length : eol + 1;
      continue;
    }

    // Block comments nest in ClickHouse.
    if (ch === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      if (depth > 0) return { ok: false, reason: "Unclosed comment" };
      i = j;
      continue;
    }

    if (ch === "'") {
      const read = readQuoted(sql, i, "'");
      if (!read) return { ok: false, reason: "Unclosed string" };
      tokens.push({ kind: "string", value: read.value, start: i });
      i = read.end;
      continue;
    }

    if (ch === '"' || ch === "`") {
      const read = readQuoted(sql, i, ch);
      if (!read) return { ok: false, reason: "Unclosed quoted name" };
      tokens.push({ kind: "quotedName", value: read.value, start: i });
      i = read.end;
      continue;
    }

    // Heredoc strings: $tag$ … $tag$ (the tag may be empty).
    if (ch === "$") {
      const open = /^\$([A-Za-z0-9_]*)\$/.exec(sql.slice(i));
      if (open) {
        const delimiter = open[0];
        const close = sql.indexOf(delimiter, i + delimiter.length);
        if (close === -1) return { ok: false, reason: "Unclosed heredoc string" };
        tokens.push({ kind: "string", value: sql.slice(i + delimiter.length, close), start: i });
        i = close + delimiter.length;
        continue;
      }
    }

    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < sql.length && WORD_PART.test(sql[j])) j++;
      tokens.push({ kind: "word", value: sql.slice(i, j), start: i });
      i = j;
      if (insertDataStarts(tokens, depth)) return { ok: true, tokens, dataStart: j };
      continue;
    }

    if (DIGIT.test(ch) || (ch === "." && next !== undefined && DIGIT.test(next) && !isNameBefore(tokens))) {
      const match = /^(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(sql.slice(i));
      const text = match ? match[0] : ch;
      tokens.push({ kind: "number", value: text, start: i });
      i += text.length;
      continue;
    }

    if (ch === "(") depth++;
    if (ch === ")") depth--;
    tokens.push({ kind: "symbol", value: ch, start: i });
    i++;
  }
  return { ok: true, tokens };
}

/** `t.1` (tuple element) lexes as name, `.`, number — not as `t` then `.1`. */
function isNameBefore(tokens: Token[]): boolean {
  const last = tokens[tokens.length - 1];
  return !!last && (last.kind === "word" || last.kind === "quotedName" || (last.kind === "symbol" && (last.value === ")" || last.value === "]")));
}

/** Upper-cased word at `index`, or "" for anything else. */
export function keywordAt(tokens: Token[], index: number): string {
  const token = tokens[index];
  return token && token.kind === "word" ? token.value.toUpperCase() : "";
}

/**
 * A name the tree printout can carry without ambiguity: letters, digits, `_`,
 * `-` and `$`. A dot reads as `db.table`, and whitespace, quotes or brackets
 * could forge or hide printout lines.
 */
export function isPlainName(name: string): boolean {
  return /^[A-Za-z0-9_$-]+$/.test(name);
}
