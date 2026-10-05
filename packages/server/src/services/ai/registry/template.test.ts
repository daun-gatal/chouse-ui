import { describe, expect, it } from "bun:test";

import { renderTemplate, templateReferences, TemplateError, validateTemplate } from "./template";

const noSkills = (): string => {
  throw new Error("no skills expected");
};

describe("renderTemplate", () => {
  it("inserts variables and leaves every other brace sequence literal", () => {
    const out = renderTemplate(
      "Node {{ctx.node.id}} uses {{slot_start}}/{{slot_end}} and {{ ctx.x }} and {{ctx}}",
      { "node.id": "n-1" },
      noSkills,
    );
    expect(out).toBe("Node n-1 uses {{slot_start}}/{{slot_end}} and {{ ctx.x }} and {{ctx}}");
  });

  it("renders sections only when the value is truthy", () => {
    const tpl = "a{{#ctx.extra}}\n\nExtra: {{ctx.extra}}{{/ctx.extra}}b";
    expect(renderTemplate(tpl, { extra: "x" }, noSkills)).toBe("a\n\nExtra: xb");
    expect(renderTemplate(tpl, { extra: "" }, noSkills)).toBe("ab");
    expect(renderTemplate("{{#ctx.f}}y{{/ctx.f}}", { f: false }, noSkills)).toBe("");
    expect(renderTemplate("{{#ctx.f}}y{{/ctx.f}}", { f: 0 }, noSkills)).toBe("");
    expect(renderTemplate("{{#ctx.f}}y{{/ctx.f}}", { f: 2 }, noSkills)).toBe("y");
    expect(renderTemplate("{{#ctx.f}}y{{/ctx.f}}", { f: null }, noSkills)).toBe("");
  });

  it("supports nested sections", () => {
    const tpl = "{{#ctx.a}}A{{#ctx.b}}B{{/ctx.b}}{{/ctx.a}}";
    expect(renderTemplate(tpl, { a: true, b: true }, noSkills)).toBe("AB");
    expect(renderTemplate(tpl, { a: true, b: false }, noSkills)).toBe("A");
    expect(renderTemplate(tpl, { a: false, b: true }, noSkills)).toBe("");
  });

  it("renders null and numbers predictably", () => {
    expect(renderTemplate("[{{ctx.v}}]", { v: null }, noSkills)).toBe("[]");
    expect(renderTemplate("[{{ctx.v}}]", { v: 6 }, noSkills)).toBe("[6]");
  });

  it("inlines skills through the resolver", () => {
    const seen: Array<[string, string | null]> = [];
    const out = renderTemplate("x {{skill:system-table-reference/reference.md}} y {{skill:playbook}}", {}, (name, file) => {
      seen.push([name, file]);
      return `<${name}:${file ?? "SKILL.md"}>`;
    });
    expect(out).toBe("x <system-table-reference:reference.md> y <playbook:SKILL.md>");
    expect(seen).toEqual([["system-table-reference", "reference.md"], ["playbook", null]]);
  });

  it("fails closed on variables the caller did not supply", () => {
    expect(() => renderTemplate("{{ctx.missing}}", {}, noSkills)).toThrow(TemplateError);
    expect(() => renderTemplate("{{#ctx.missing}}x{{/ctx.missing}}", {}, noSkills)).toThrow(TemplateError);
  });

  it("rejects unbalanced sections", () => {
    expect(() => renderTemplate("{{#ctx.a}}x", { a: true }, noSkills)).toThrow("never closed");
    expect(() => renderTemplate("x{{/ctx.a}}", { a: true }, noSkills)).toThrow("no open section");
    expect(() => renderTemplate("{{#ctx.a}}x{{/ctx.b}}", { a: true, b: true }, noSkills)).toThrow("closed by");
  });
});

describe("templateReferences / validateTemplate", () => {
  it("collects variables, sections and skills", () => {
    const refs = templateReferences("{{ctx.a}} {{#ctx.b}}{{ctx.c}}{{/ctx.b}} {{skill:s/f.md}}");
    expect([...refs.variables].sort()).toEqual(["a", "b", "c"]);
    expect(refs.skills).toEqual([{ name: "s", file: "f.md" }]);
  });

  it("reports unknown variables, missing skills and parse errors", () => {
    const declared = { a: { type: "string" as const, description: "" } };
    const exists = (name: string): boolean => name === "known";
    expect(validateTemplate("{{ctx.a}} {{skill:known}}", declared, exists)).toEqual([]);
    expect(validateTemplate("{{ctx.b}}", declared, exists)).toEqual(["Unknown template variable ctx.b"]);
    expect(validateTemplate("{{skill:nope/x.md}}", declared, exists)).toEqual(["Unknown skill reference {{skill:nope/x.md}}"]);
    expect(validateTemplate("{{#ctx.a}}", declared, exists)[0]).toContain("never closed");
  });
});
