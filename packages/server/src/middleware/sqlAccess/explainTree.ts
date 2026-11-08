/**
 * Strict reader for ClickHouse `EXPLAIN AST` output (ADR 0030 §5).
 *
 * The printout is one line per node: indentation (one space per level), the
 * node name and its arguments, an optional ` (alias x)` and an optional
 * ` (children N)`. This reader rebuilds the tree and refuses anything that
 * doesn't fit: a second root, an indentation jump, a children count that
 * doesn't match the lines beneath, or a `Literal` with children. A printout
 * that was cut short or has a forged line fails one of those checks.
 */

export interface AstNode {
  /** First word of the line, e.g. `TableIdentifier`, `Function`, `Storage`. */
  name: string;
  /** The rest of the head, e.g. `db.t` for a TableIdentifier, `in` for a Function. */
  args: string;
  alias?: string;
  children: AstNode[];
}

export type TreeResult = { ok: true; root: AstNode } | { ok: false; reason: string };

interface ParsedLine {
  depth: number;
  node: AstNode;
  declared: number;
}

const SUFFIX = /^(.*?)(?: \(alias ([^()]*)\))?(?: \(children (\d+)\))?$/;
const LITERAL_ALIAS = / \(alias ([^()'"`]*)\)$/;

function parseLine(raw: string): ParsedLine | null {
  const depth = raw.length - raw.trimStart().length;
  if (raw.slice(0, depth).replace(/ /g, "") !== "") return null; // tabs or other indentation
  const text = raw.slice(depth);
  if (text === "") return null;

  // A Literal's printed value may itself contain "(children N)" inside quotes,
  // so only an alias is taken off its end; it never has children.
  if (text === "Literal" || text.startsWith("Literal ")) {
    let args = text.slice("Literal".length).trim();
    let alias: string | undefined;
    const aliased = LITERAL_ALIAS.exec(args);
    if (aliased) {
      alias = aliased[1];
      args = args.slice(0, aliased.index);
    }
    return { depth, declared: 0, node: { name: "Literal", args, alias, children: [] } };
  }

  const match = SUFFIX.exec(text);
  if (!match) return null;
  const head = match[1].trim();
  const space = head.indexOf(" ");
  const name = space === -1 ? head : head.slice(0, space);
  const args = space === -1 ? "" : head.slice(space + 1).trim();
  if (!/^[A-Za-z][A-Za-z0-9_:]*$/.test(name)) return null;
  return {
    depth,
    declared: match[3] === undefined ? 0 : Number(match[3]),
    node: { name, args, alias: match[2], children: [] },
  };
}

/** Rebuild the tree from printout lines, or say why it can't be trusted. */
export function readExplainTree(lines: string[]): TreeResult {
  const parsed: ParsedLine[] = [];
  for (const raw of lines) {
    if (raw.trim() === "") continue;
    const line = parseLine(raw);
    if (!line) return { ok: false, reason: "unreadable printout line" };
    parsed.push(line);
  }
  if (parsed.length === 0) return { ok: false, reason: "empty printout" };
  if (parsed[0].depth !== 0) return { ok: false, reason: "printout does not start at the root" };

  const stack: ParsedLine[] = [];
  for (const line of parsed) {
    if (line.depth === 0 && stack.length > 0) return { ok: false, reason: "more than one root" };
    // Pop back to this line's parent; a child is exactly one level deeper.
    while (stack.length > line.depth) stack.pop();
    if (stack.length !== line.depth) return { ok: false, reason: "indentation jumps a level" };
    const parent = stack[stack.length - 1];
    if (parent) {
      if (parent.node.name === "Literal") return { ok: false, reason: "a literal has children" };
      parent.node.children.push(line.node);
    }
    stack.push(line);
  }

  for (const line of parsed) {
    if (line.node.children.length !== line.declared) return { ok: false, reason: `children count mismatch at ${line.node.name}` };
  }
  return { ok: true, root: parsed[0].node };
}

/** Every node in pre-order (the node, then its children left to right). */
export function* preOrder(node: AstNode): Generator<AstNode> {
  yield node;
  for (const child of node.children) yield* preOrder(child);
}
