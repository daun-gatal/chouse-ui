import { describe, expect, it } from "bun:test";
import { isPlainName, lex, type Token } from "./lexer";

function words(sql: string): string[] {
  const result = lex(sql);
  if (!result.ok) throw new Error(result.reason);
  return result.tokens.map((t: Token) => `${t.kind}:${t.value}`);
}

describe("lex", () => {
  it("skips --, # and nested block comments like ClickHouse", () => {
    expect(words("SELECT 1 # FROM secret.s\n, 2")).toEqual(["word:SELECT", "number:1", "symbol:,", "number:2"]);
    expect(words("SELECT 1 /* a /* b */ FROM secret.s */")).toEqual(["word:SELECT", "number:1"]);
    expect(words("SELECT 1 -- x")).toEqual(["word:SELECT", "number:1"]);
  });

  it("reads strings with \\ and '' escapes, and heredocs", () => {
    expect(words("SELECT 'a\\'b', 'c''d', $$x'y$$, $t$z$t$")).toEqual([
      "word:SELECT", "string:a'b", "symbol:,", "string:c'd", "symbol:,", "string:x'y", "symbol:,", "string:z",
    ]);
  });

  it("reads quoted names with doubled quotes, keeping their real value", () => {
    expect(words('SELECT "a""b", `c``d`, `e\\nf`')).toEqual(["word:SELECT", "quotedName:a\"b", "symbol:,", "quotedName:c`d", "symbol:,", "quotedName:enf"]);
    expect(words("SELECT `a\nb`")).toEqual(["word:SELECT", "quotedName:a\nb"]);
  });

  it("keeps SQL words inside strings and comments out of the word list", () => {
    expect(words("SELECT 'SELECT dictGet(' -- SELECT\n")).toEqual(["word:SELECT", "string:SELECT dictGet("]);
  });

  it("lexes tuple access and numbers", () => {
    expect(words("SELECT t.1, 1.5, .5e3, 0x1F")).toEqual(["word:SELECT", "word:t", "symbol:.", "number:1", "symbol:,", "number:1.5", "symbol:,", "number:.5e3", "symbol:,", "number:0x1F"]);
  });

  it("stops at raw INSERT data, which ClickHouse never reads as SQL", () => {
    expect(words("INSERT INTO t FORMAT CSV\n1,it's a select\n")).toEqual(["word:INSERT", "word:INTO", "word:t", "word:FORMAT", "word:CSV"]);
    expect(words("INSERT INTO t SETTINGS async_insert=1 FORMAT TSV\nselect\t'")).toEqual(["word:INSERT", "word:INTO", "word:t", "word:SETTINGS", "word:async_insert", "symbol:=", "number:1", "word:FORMAT", "word:TSV"]);
  });

  it("keeps lexing VALUES data, which is SQL", () => {
    expect(words("INSERT INTO t FORMAT Values ((SELECT 1))")).toContain("word:SELECT");
    expect(words("INSERT INTO t VALUES ((SELECT 1))")).toContain("word:SELECT");
  });

  it("refuses text it can't close", () => {
    for (const sql of ["SELECT 'a", "SELECT `a", "SELECT /* a", "SELECT $$a", "SELECT /* /* */"]) {
      expect(lex(sql).ok).toBe(false);
    }
  });
});

describe("isPlainName", () => {
  it("accepts names the printout carries safely", () => {
    for (const name of ["events", "my-db", "ev_ents", "a$1"]) expect(isPlainName(name)).toBe(true);
  });

  it("refuses dots, whitespace, quotes and brackets", () => {
    for (const name of ["a.b", "a b", "a\nb", "a(b", "a'b", "a`b", "", "a)b"]) expect(isPlainName(name)).toBe(false);
  });
});
