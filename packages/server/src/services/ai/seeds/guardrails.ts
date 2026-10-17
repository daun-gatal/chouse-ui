/**
 * Built-in guardrails (ADR 0022 §5), inserted and upgraded by the registry
 * seed sync like built-in agents. The enable switch, mode and position are an
 * administrator's operational choices: an upgrade keeps them and editing them
 * does not mark the row customized.
 */

import type { GuardrailDef } from "../guardrails/types";

export type SeedGuardrail = Pick<GuardrailDef, "id" | "slug" | "name" | "description" | "kind" | "config" | "stages" | "action" | "scope"> & {
  /** Initial operational settings; kept across upgrades. */
  defaults: Pick<GuardrailDef, "enabled" | "mode" | "position">;
};

const EVERYWHERE = { agents: "all", features: "all", mcp: true } as const;
const AGENTS_ONLY = { agents: "all", features: "all", mcp: false } as const;

export const SEED_GUARDRAILS: SeedGuardrail[] = [
  {
    id: "builtin-guardrail-result-cap",
    slug: "result-size-cap",
    name: "Result size cap",
    description: "Cuts large tool results before they reach the model: fewer tokens, and less data sent to the provider.",
    kind: "limits",
    config: { maxToolCalls: null, maxModelCalls: null, maxResultRows: 1000, maxResultBytes: 262_144 },
    stages: ["tool_result"],
    action: "redact",
    scope: { ...EVERYWHERE },
    defaults: { enabled: true, mode: "enforce", position: 10 },
  },
  {
    id: "builtin-guardrail-pii",
    slug: "pii-redaction",
    name: "PII redaction",
    description: "Replaces email addresses, card numbers, phone numbers and IP addresses in tool results before the model sees them.",
    kind: "pattern",
    config: { detectors: ["email", "card", "phone", "ip"], patterns: [], strategy: "placeholder" },
    stages: ["tool_result"],
    action: "redact",
    scope: { ...EVERYWHERE },
    defaults: { enabled: true, mode: "enforce", position: 20 },
  },
  {
    id: "builtin-guardrail-columns",
    slug: "sensitive-columns",
    name: "Sensitive column masking",
    description: "Hides the values of columns you list (names or globs such as users.email or *_ssn). Add your columns, then enable it.",
    kind: "columns",
    config: { columns: ["*ssn*", "*password*", "*secret*"], strategy: "placeholder" },
    stages: ["tool_result"],
    action: "redact",
    scope: { ...EVERYWHERE },
    defaults: { enabled: false, mode: "enforce", position: 30 },
  },
  {
    id: "builtin-guardrail-secrets",
    slug: "secret-detection",
    name: "Secret detection",
    description: "Redacts access tokens, cloud keys, private keys and passwords in URLs wherever they appear: what users type, tool results and model answers.",
    kind: "pattern",
    config: { detectors: ["aws_key", "chouse_token", "jwt", "private_key", "password_in_url", "bearer_token"], patterns: [], strategy: "placeholder" },
    stages: ["input", "tool_result", "output"],
    action: "redact",
    scope: { ...EVERYWHERE },
    defaults: { enabled: true, mode: "enforce", position: 40 },
  },
  {
    id: "builtin-guardrail-injection",
    slug: "prompt-injection-shield",
    name: "Prompt-injection shield",
    description: "Marks tool results that contain instruction-like text as untrusted data, so the model does not follow instructions hidden in table rows.",
    kind: "injection",
    config: { extraPhrases: [] },
    stages: ["tool_result"],
    action: "warn",
    scope: { ...EVERYWHERE },
    defaults: { enabled: true, mode: "enforce", position: 50 },
  },
  {
    id: "builtin-guardrail-call-limits",
    slug: "call-limits",
    name: "Call limits",
    description: "Stops a run that makes more than 120 tool calls or 80 model calls, which only happens when an agent is stuck in a loop.",
    kind: "limits",
    config: { maxToolCalls: 120, maxModelCalls: 80, maxResultRows: null, maxResultBytes: null },
    stages: ["tool_call"],
    action: "block",
    scope: { ...AGENTS_ONLY },
    defaults: { enabled: true, mode: "enforce", position: 60 },
  },
  {
    id: "builtin-guardrail-sql",
    slug: "sql-safety",
    name: "SQL safety",
    description: "Refuses SQL an agent writes unless it is read-only, has a LIMIT, avoids denied tables and stays under an estimated row count.",
    kind: "sql",
    config: { readOnly: true, requireLimit: true, denyDatabases: [], denyTables: [], maxEstimatedRows: 1_000_000_000 },
    stages: ["tool_call"],
    action: "block",
    scope: { ...AGENTS_ONLY },
    defaults: { enabled: false, mode: "enforce", position: 70 },
  },
  {
    id: "builtin-guardrail-topic",
    slug: "topic-restriction",
    name: "Topic restriction",
    description: "An AI judge keeps the chat on ClickHouse and CHouse topics. Choose the model that judges, then enable it.",
    kind: "judge",
    config: { rule: "The message asks for help with something unrelated to ClickHouse, databases, data analysis or operating CHouse.", modelConfigId: null },
    stages: ["input"],
    action: "block",
    scope: { agents: "all", features: ["chat"], mcp: false },
    defaults: { enabled: false, mode: "enforce", position: 80 },
  },
];
