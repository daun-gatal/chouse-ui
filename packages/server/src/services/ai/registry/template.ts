/**
 * Logic-less, namespaced prompt templates (ADR 0019 §5).
 *
 * Only three forms are interpreted; every other character is literal, so
 * prompts may keep text such as `{{slot_start}}` untouched:
 *
 * - `{{ctx.name}}`                  insert a feature variable
 * - `{{#ctx.flag}} … {{/ctx.flag}}` keep the section when the variable is truthy
 * - `{{skill:name}}` / `{{skill:name/file.md}}` inline a skill's SKILL.md or one
 *   of its files (trimmed)
 */

export type TemplateValue = string | number | boolean | null | undefined;

export type VariableType = "string" | "number" | "boolean" | "json";

export interface VariableSpec {
  type: VariableType;
  description: string;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

type Node =
  | { kind: "text"; text: string }
  | { kind: "var"; name: string }
  | { kind: "skill"; name: string; file: string | null }
  | { kind: "section"; name: string; children: Node[] };

const VAR_NAME = "[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)*";
const SKILL_REF = "[a-z0-9][a-z0-9-]*(?:/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)?";
const TOKEN = new RegExp(`\\{\\{(?:ctx\\.(${VAR_NAME})|#ctx\\.(${VAR_NAME})|/ctx\\.(${VAR_NAME})|skill:(${SKILL_REF}))\\}\\}`, "g");

function parse(source: string): Node[] {
  const root: Node[] = [];
  const stack: Array<{ name: string; children: Node[] }> = [];
  const current = (): Node[] => (stack.length > 0 ? stack[stack.length - 1].children : root);
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) current().push({ kind: "text", text: source.slice(last, index) });
    last = index + match[0].length;
    const [, variable, open, close, skill] = match;
    if (variable) {
      current().push({ kind: "var", name: variable });
    } else if (open) {
      stack.push({ name: open, children: [] });
    } else if (close) {
      const top = stack.pop();
      if (!top) throw new TemplateError(`Unexpected {{/ctx.${close}}} with no open section`);
      if (top.name !== close) throw new TemplateError(`Section {{#ctx.${top.name}}} is closed by {{/ctx.${close}}}`);
      current().push({ kind: "section", name: top.name, children: top.children });
    } else if (skill) {
      const slash = skill.indexOf("/");
      current().push(slash === -1
        ? { kind: "skill", name: skill, file: null }
        : { kind: "skill", name: skill.slice(0, slash), file: skill.slice(slash + 1) });
    }
  }
  if (stack.length > 0) throw new TemplateError(`Section {{#ctx.${stack[stack.length - 1].name}}} is never closed`);
  if (last < source.length) current().push({ kind: "text", text: source.slice(last) });
  return root;
}

export interface TemplateReferences {
  variables: Set<string>;
  skills: Array<{ name: string; file: string | null }>;
}

/** Every variable (inserted or used as a section) and skill a template references. */
export function templateReferences(source: string): TemplateReferences {
  const refs: TemplateReferences = { variables: new Set(), skills: [] };
  const visit = (nodes: Node[]): void => {
    for (const node of nodes) {
      if (node.kind === "var") refs.variables.add(node.name);
      else if (node.kind === "skill") refs.skills.push({ name: node.name, file: node.file });
      else if (node.kind === "section") {
        refs.variables.add(node.name);
        visit(node.children);
      }
    }
  };
  visit(parse(source));
  return refs;
}

function truthy(value: TemplateValue): boolean {
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  return value === true;
}

function stringify(value: TemplateValue): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export type SkillResolver = (name: string, file: string | null) => string;

/**
 * Render a template. Throws TemplateError for a variable the caller did not
 * supply — a missing variable is a misconfiguration and must fail closed.
 */
export function renderTemplate(
  source: string,
  variables: Record<string, TemplateValue>,
  resolveSkill: SkillResolver,
): string {
  const render = (nodes: Node[]): string => {
    let out = "";
    for (const node of nodes) {
      if (node.kind === "text") out += node.text;
      else if (node.kind === "skill") out += resolveSkill(node.name, node.file);
      else {
        if (!Object.prototype.hasOwnProperty.call(variables, node.name)) {
          throw new TemplateError(`Unknown template variable ctx.${node.name}`);
        }
        const value = variables[node.name];
        if (node.kind === "var") out += stringify(value);
        else if (truthy(value)) out += render(node.children);
      }
    }
    return out;
  };
  return render(parse(source));
}

/**
 * Validate a template against the variables a feature declares and the skills
 * that exist. Returns human-readable problems (empty when valid).
 */
export function validateTemplate(
  source: string,
  declared: Record<string, VariableSpec>,
  skillFileExists: (name: string, file: string | null) => boolean,
): string[] {
  let refs: TemplateReferences;
  try {
    refs = templateReferences(source);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const problems: string[] = [];
  for (const name of refs.variables) {
    if (!Object.prototype.hasOwnProperty.call(declared, name)) problems.push(`Unknown template variable ctx.${name}`);
  }
  for (const ref of refs.skills) {
    if (!skillFileExists(ref.name, ref.file)) {
      problems.push(`Unknown skill reference {{skill:${ref.name}${ref.file ? `/${ref.file}` : ""}}}`);
    }
  }
  return problems;
}
