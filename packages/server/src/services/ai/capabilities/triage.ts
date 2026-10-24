/**
 * triage-incident (ADR 0024 §Phase 4): investigate a new incident, alert,
 * failed run or Doctor report without being asked. The agent reads the
 * subject's connection through `query_node` (read-only system tables) and can
 * only propose actions; the runner records what it found and where it went.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { resolveNodes, type FleetNode } from "./fleetShared";
import { TRIAGE_TRIGGERS, TRIGGER_LABELS, type TriageTrigger } from "../triage/subjects";
import type { StructuredCapability } from "../types";

const TriageParsed = z.object({
  summary: z.string(),
  likelyCause: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  severity: z.enum(["low", "medium", "high"]),
  findings: z.array(z.string()).max(8),
  nextSteps: z.array(z.string()).max(6),
});

export type TriageParsedResult = z.infer<typeof TriageParsed>;

export interface TriageFindings extends TriageParsedResult {
  model: string;
  generatedAt: number;
}

export interface TriageInput {
  trigger: TriageTrigger;
  title: string;
  /** The connection to investigate; null lets the agent look at every active connection. */
  connectionId: string | null;
  evidence: Record<string, unknown>;
}

interface TriagePrepared extends TriageInput {
  nodes: FleetNode[];
}

/** Evidence goes to the provider: keep it to a size a prompt can carry. */
const EVIDENCE_CHARS = 12_000;

function evidenceText(evidence: Record<string, unknown>): string {
  const text = JSON.stringify(evidence, null, 2);
  return text.length > EVIDENCE_CHARS ? `${text.slice(0, EVIDENCE_CHARS)}\n… (truncated)` : text;
}

export const triageIncidentCapability: StructuredCapability<TriageInput, TriagePrepared, TriageParsedResult, TriageFindings> = {
  id: "triage-incident",
  title: "Auto-triage",
  description: "AI Governance › Auto-triage: investigates new incidents, alerts, failed scheduled runs and Doctor findings on its own, and proposes actions for approval.",
  surface: "observe",
  delivery: "structured",
  permission: PERMISSIONS.AI_AGENTS_MANAGE,
  contexts: ["fleet"],
  background: true,
  variables: {
    trigger: { type: "string", description: "What happened, e.g. \"Failed scheduled run\"." },
    title: { type: "string", description: "The subject's title." },
    evidence: { type: "json", description: "What CHouse knows about the subject (pretty-printed JSON)." },
    nodes: { type: "json", description: "Connections the agent may query with query_node (id and name)." },
  },
  inputSchema: z.object({
    trigger: z.enum(TRIAGE_TRIGGERS),
    title: z.string().min(1).max(500),
    connectionId: z.string().min(1).nullable(),
    evidence: z.record(z.string(), z.unknown()),
  }),
  outputSchema: TriageParsed,

  async prepare(input) {
    const nodes = await resolveNodes(input.connectionId ? [input.connectionId] : undefined);
    return { ...input, nodes };
  },

  fleetNodes: (prepared) => prepared.nodes,

  templateVariables(prepared) {
    return {
      trigger: TRIGGER_LABELS[prepared.trigger],
      title: prepared.title,
      evidence: evidenceText(prepared.evidence),
      nodes: JSON.stringify(prepared.nodes),
    };
  },

  finalize(parsed, _prepared, _ctx, meta) {
    return { ...parsed, model: meta.modelLabel, generatedAt: Date.now() };
  },
};
