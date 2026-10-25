/**
 * suggest-memories (ADR 0026 §9): when a Chobi conversation goes quiet, one
 * call reads it and suggests up to three notes worth keeping — about the
 * person, or about the ClickHouse connection for the team. It never saves:
 * Chobi shows them as chips and a person chooses. The route screens each
 * suggestion with the guardrails and drops what memory already holds.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { MEMORY_MAX_CHARS } from "../memory/store";
import type { StructuredCapability } from "../types";

export const MAX_SUGGESTIONS = 3;

const SuggestionsSchema = z.object({
  suggestions: z.array(z.object({
    note: z.string().min(3).max(MEMORY_MAX_CHARS).describe("One short sentence that still makes sense later"),
    scope: z.enum(["user", "connection"]).describe('"user" for this person; "connection" for team knowledge about this ClickHouse connection'),
  })).max(MAX_SUGGESTIONS),
});

export type SuggestedMemories = z.infer<typeof SuggestionsSchema>;

export interface MemorySuggestInput {
  /** The conversation, oldest first, each turn trimmed. */
  turns: Array<{ role: "user" | "assistant"; text: string }>;
  /** What memory already holds, so nothing is suggested twice. */
  existing: { user: string[]; team: string[] };
  /** False when the person turned memory off: only team notes may be suggested. */
  userMemory: boolean;
}

const RULES = [
  "Only lasting facts and preferences (\"always use UTC\", \"orders_v1 is deprecated\"); never one-off details of this conversation.",
  "Never secrets, credentials, personal data, or anything copied from query results.",
  "Nothing already in evidence.existing, even reworded.",
  "scope user: about this person. scope connection: knowledge about this ClickHouse connection that helps the whole team.",
  "When userMemory is false, suggest connection notes only.",
  "Suggest nothing when nothing qualifies; at most three.",
];

export const suggestMemoriesCapability: StructuredCapability<MemorySuggestInput, MemorySuggestInput, SuggestedMemories, SuggestedMemories> = {
  id: "suggest-memories",
  title: "Suggest memories",
  description: "Chobi › chat: after a conversation, suggests up to three notes worth keeping for the person or the team; a person chooses what is saved.",
  surface: "chat",
  contexts: [],
  variables: { evidence: { type: "json", description: "The conversation, what memory already holds, and the rules (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_CHAT,
  inputSchema: z.object({
    turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).min(1),
    existing: z.object({ user: z.array(z.string()), team: z.array(z.string()) }),
    userMemory: z.boolean(),
  }),
  outputSchema: SuggestionsSchema,
  prepare: (input) => input,
  templateVariables: (prepared) => ({ evidence: JSON.stringify({ conversation: prepared.turns, existing: prepared.existing, userMemory: prepared.userMemory, rules: RULES }) }),
  finalize: (parsed) => parsed,
};
