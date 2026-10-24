/**
 * Turning a chat run's final state into what the thread stores and the browser
 * shows: the answer without leaked scratchpad text, its tool calls with
 * JSON-safe results, and the charts render_chart produced. Shared by the
 * one-shot /invoke route and durable chat runs (ADR 0024).
 */

import type { InvokedToolCall } from "../registry/builder";

/**
 * Strip chain-of-thought / scratchpad reasoning that some models leak
 * into the text response.
 * 
 * Pattern observed: "analysis<reasoning>assistantfinal<actual answer>"
 * Strategy: find the LAST known end-marker and extract only what follows.
 */
export function stripScratchpad(text: string): string {
    if (!text) return text;

    const lowerText = text.toLowerCase();

    // Find the last occurrence of any known scratchpad end-marker.
    // Everything before + including the marker is reasoning — discard it.
    const endMarkers = [
        'assistantfinal',       // Most common: "analysisXXXassistantfinalYYY"
        'assistant\nfinal',     // "assistant\nfinal" with newline
        'assistant final',      // "assistant final" with space
        '\nfinal\n',            // "final" on its own line
        '\nfinal',              // "final" followed immediately by text (no trailing newline)
    ];

    let bestCut = -1;
    for (const marker of endMarkers) {
        const idx = lowerText.lastIndexOf(marker);
        if (idx !== -1) {
            const cutAt = idx + marker.length;
            if (cutAt > bestCut) bestCut = cutAt;
        }
    }

    if (bestCut > 0 && bestCut < text.length) {
        return text.substring(bestCut).trim();
    }

    // Fallback: handle leading CoT markers that appear at the very start of the
    // buffer without a preceding newline (e.g. "finalBelow is..." or "analysisHere")
    const trimmed = text.trimStart();

    // Strip a bare "final" CoT marker at the start.
    // Preserve real words like "finally", "finalize" (lowercase continuation).
    // Catches: "finalBelow...", "final**text**", "final## ...", "final\n..."
    if (trimmed.length >= 5 && trimmed.slice(0, 5).toLowerCase() === 'final') {
        if (trimmed.length === 5 || !/[a-z]/.test(trimmed[5])) {
            return trimmed.slice(5).trim();
        }
    }

    // Strip leading "analysis..." blocks — look for first markdown element
    if (/^(analysis|thinking)/i.test(trimmed)) {
        const mdMatch = trimmed.match(/\n\s*(?=[|#\-*>\d])/);
        if (mdMatch && mdMatch.index && mdMatch.index > 0) {
            return trimmed.substring(mdMatch.index).trim();
        }
    }

    return text;
}

export function jsonSafe(value: unknown): unknown {
    if (typeof value === "bigint") {
        return value <= Number.MAX_SAFE_INTEGER ? Number(value) : value.toString();
    }
    if (Array.isArray(value)) return value.map(jsonSafe);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [key, jsonSafe(nested)]),
        );
    }
    return value;
}

/** Unwrap LangChain tool-message content and JSON-serialized tool results. */
export function parseToolResult(value: unknown, depth = 0): unknown {
    if (depth > 3) return value;
    if (typeof value === "string") {
        try {
            return parseToolResult(JSON.parse(value), depth + 1);
        } catch {
            return value;
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;

    const record = value as Record<string, unknown>;
    if ("chartType" in record || "rows" in record || "error" in record) return record;
    if ("artifact" in record && record.artifact !== undefined) {
        return parseToolResult(record.artifact, depth + 1);
    }
    if (typeof record.content === "string") {
        return parseToolResult(record.content, depth + 1);
    }
    if (Array.isArray(record.content)) {
        const text = record.content
            .filter((part): part is { text: string } =>
                !!part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string")
            .map((part) => part.text)
            .join("");
        if (text) return parseToolResult(text, depth + 1);
    }
    return record;
}

export interface ChatAnswerToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  agent?: string;
}

/** The stored and displayed form of a run's tool calls and charts. */
export function chatAnswer(calls: InvokedToolCall[], answeringAgentSlug: string): { toolCalls: ChatAnswerToolCall[]; chartSpecs: Array<Record<string, unknown>> } {
  const toolCalls = calls.map((call) => ({
    name: call.name,
    args: call.args,
    result: jsonSafe(parseToolResult(call.result)),
    // Only calls made below the agent that answered carry a path.
    ...(call.agent && call.agent !== answeringAgentSlug ? { agent: call.agent } : {}),
  }));
  const chartSpecs = toolCalls
    .filter((call) => call.name === "render_chart" && call.result && typeof call.result === "object" && !("error" in call.result))
    .map((call) => call.result as Record<string, unknown>);
  return { toolCalls, chartSpecs };
}
