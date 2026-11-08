import { describe, expect, it } from "bun:test";
import { readExplainTree } from "./explainTree";

const SELECT = [
  "SelectWithUnionQuery (children 1)",
  " ExpressionList (children 1)",
  "  SelectQuery (children 2)",
  "   ExpressionList (children 1)",
  "    Literal 'a\\nb (children 3)' (alias x)",
  "   TablesInSelectQuery (children 1)",
  "    TablesInSelectQueryElement (children 1)",
  "     TableExpression (children 1)",
  "      TableIdentifier db.t (alias a)",
];

describe("readExplainTree", () => {
  it("rebuilds the tree, names, arguments and aliases", () => {
    const result = readExplainTree(SELECT);
    if (!result.ok) throw new Error(result.reason);
    const literal = result.root.children[0].children[0].children[0].children[0];
    expect(literal).toMatchObject({ name: "Literal", args: "'a\\nb (children 3)'", alias: "x", children: [] });
    const table = result.root.children[0].children[0].children[1].children[0].children[0].children[0];
    expect(table).toMatchObject({ name: "TableIdentifier", args: "db.t", alias: "a" });
  });

  it("refuses a printout cut short", () => {
    expect(readExplainTree(SELECT.slice(0, -1)).ok).toBe(false);
  });

  it("refuses a forged extra line", () => {
    const forged = [...SELECT.slice(0, -1), "      TableIdentifier a", "      TableIdentifier secret.s"];
    expect(readExplainTree(forged)).toEqual({ ok: false, reason: "children count mismatch at TableExpression" });
  });

  it("refuses a second root, an indentation jump and a literal with children", () => {
    expect(readExplainTree(["Set", "Set"]).ok).toBe(false);
    expect(readExplainTree(["SelectWithUnionQuery (children 1)", "  ExpressionList"]).ok).toBe(false);
    expect(readExplainTree(["Literal 'x'", " Identifier y"]).ok).toBe(false);
    expect(readExplainTree([" Set"]).ok).toBe(false);
    expect(readExplainTree([]).ok).toBe(false);
  });
});
