/**
 * The tables a read-only statement reads, for data egress labels (ADR 0020 §2).
 *
 * The generic parser (middleware/sqlParser) is built for access checks and
 * errs towards reporting more: `system.columns` also yields a bare `system`,
 * quoted names with dashes are cut short. A label must name exactly what the
 * user would recognize, so this scanner reads only the `FROM` / `JOIN` targets
 * at query level (and `DESCRIBE` / `SHOW CREATE` targets), skipping table
 * functions, subqueries, CTE names, `ARRAY JOIN` and `FROM` inside function
 * calls such as `extract(DAY FROM d)`.
 */

const IDENT = String.raw`(?:\`(?:[^\`]|\`\`)+\`|"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const NAME_AT = new RegExp(String.raw`^\s*(${IDENT})(?:\s*\.\s*(${IDENT}))?`);
const DESCRIBE = new RegExp(String.raw`^\s*(?:DESCRIBE|DESC|SHOW\s+CREATE)\s+(?:TABLE\s+)?(${IDENT})(?:\s*\.\s*(${IDENT}))?`, "i");
const CTE = new RegExp(String.raw`(?:\bWITH|,)\s*(${IDENT})\s+AS\s*\(`, "gi");

function unquote(name: string): string {
  if (name.startsWith("`")) return name.slice(1, -1).replaceAll("``", "`");
  if (name.startsWith('"')) return name.slice(1, -1).replaceAll('""', '"');
  return name;
}

/** Replace comments and string literals with spaces, keeping offsets. */
function blankLiterals(sql: string): string {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.|'')*'/g, (m) => " ".repeat(m.length));
}

export function tablesOf(sql: string, defaultDatabase: string | null): string[] {
  const text = blankLiterals(sql);
  const qualify = (db: string | undefined, table: string): string => `${unquote(db ?? defaultDatabase ?? "default")}.${unquote(table)}`;
  const found = new Set<string>();

  const described = DESCRIBE.exec(text);
  if (described) {
    found.add(described[2] ? qualify(described[1], described[2]) : qualify(undefined, described[1]));
    return [...found];
  }

  const ctes = new Set<string>();
  for (const m of text.matchAll(CTE)) ctes.add(unquote(m[1]).toLowerCase());

  // Paren stack: true for a subquery "(SELECT …" / "(WITH …", false for an expression.
  const stack: boolean[] = [];
  let prevWord = "";
  const word = /[A-Za-z_][\w$]*|[()]/g;
  let m: RegExpExecArray | null;
  while ((m = word.exec(text)) !== null) {
    const token = m[0];
    if (token === "(") {
      const next = /^\s*([A-Za-z_]+)/.exec(text.slice(m.index + 1));
      stack.push(Boolean(next && /^(SELECT|WITH)$/i.test(next[1])));
      prevWord = "";
      continue;
    }
    if (token === ")") {
      stack.pop();
      prevWord = "";
      continue;
    }
    const upper = token.toUpperCase();
    const atQueryLevel = stack.every(Boolean);
    if (atQueryLevel && (upper === "FROM" || (upper === "JOIN" && prevWord !== "ARRAY"))) {
      const rest = text.slice(word.lastIndex);
      const target = NAME_AT.exec(rest);
      if (target) {
        const after = rest.slice(target[0].length);
        const isCall = /^\s*\(/.test(after);
        const [first, second] = [target[1], target[2]];
        const isCte = !second && ctes.has(unquote(first).toLowerCase());
        if (!isCall && !isCte && !/^(SELECT|WITH)$/i.test(first)) {
          found.add(second ? qualify(first, second) : qualify(undefined, first));
        }
      }
    }
    prevWord = upper;
  }
  return [...found].sort();
}
