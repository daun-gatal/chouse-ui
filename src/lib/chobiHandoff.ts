/**
 * Handing a Chobi conversation to someone else (ADR 0025 §6): a Markdown note
 * for an incident's notebook or a file, and a short message for an alert
 * channel. Built from the conversation itself, no model call.
 */

export interface HandoffMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
}

export interface HandoffAction {
  title: string;
  description: string;
  status: string;
  undone: boolean;
}

export interface HandoffInput {
  title: string;
  connection: string | null;
  at: Date;
  messages: HandoffMessage[];
  actions: HandoffAction[];
}

/** A notebook note cell holds at most this much. */
export const HANDOFF_NOTE_MAX = 20_000;
/** An alert channel message holds at most this much. */
export const HANDOFF_MESSAGE_MAX = 4_000;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 20).trimEnd()}\n\n… (cut for length)`;
}

function oneLine(text: string, max = 200): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

function actionLine(action: HandoffAction): string {
  const state = action.undone ? "undone" : action.status;
  return `- **${action.title}** — ${state}: ${oneLine(action.description, 160)}`;
}

function lastAnswer(messages: HandoffMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "assistant" && m.content.trim())?.content.trim() ?? "";
}

/** The handoff as a Markdown note: what was asked, where it landed, what changed, then the conversation. */
export function handoffMarkdown(input: HandoffInput): string {
  const asked = input.messages.filter((m) => m.role === "user" && m.content.trim());
  const sections = [
    `# Handoff: ${input.title}`,
    `_From Chobi, ${input.at.toISOString().replace("T", " ").slice(0, 16)} UTC${input.connection ? ` · connection ${input.connection}` : ""}._`,
  ];
  if (asked.length > 0) sections.push(`## What was asked\n${asked.map((m) => `- ${oneLine(m.content)}`).join("\n")}`);
  const answer = lastAnswer(input.messages);
  if (answer) sections.push(`## Where it landed\n${answer}`);
  if (input.actions.length > 0) sections.push(`## Changes made\n${input.actions.map(actionLine).join("\n")}`);
  const transcript = input.messages
    .filter((m) => m.content.trim() || m.attachments?.length)
    .map((m) => `**${m.role === "user" ? "Asked" : "Chobi"}:** ${m.content.trim()}${m.attachments?.length ? ` _(attached: ${m.attachments.join(", ")})_` : ""}`)
    .join("\n\n");
  if (transcript) sections.push(`## Conversation\n${transcript}`);
  return clip(sections.join("\n\n"), HANDOFF_NOTE_MAX);
}

/** The handoff as a short channel message: the title, where it landed and what changed. */
export function handoffMessage(input: HandoffInput): { title: string; text: string } {
  const parts: string[] = [];
  const answer = lastAnswer(input.messages);
  if (answer) parts.push(answer);
  if (input.actions.length > 0) parts.push(`Changes made:\n${input.actions.map((a) => `• ${a.title} — ${a.undone ? "undone" : a.status}`).join("\n")}`);
  if (input.connection) parts.push(`Connection: ${input.connection}`);
  return {
    title: oneLine(`Handoff: ${input.title}`, 200),
    text: clip(parts.join("\n\n") || "No answer yet.", HANDOFF_MESSAGE_MAX),
  };
}
