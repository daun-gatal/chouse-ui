/**
 * User-role messages CHouse itself sends into a run. They are not the person
 * speaking, so they never end a turn for the untrusted-data check (ADR 0025).
 */

export const EMPTY_ANSWER_NUDGE = "Write your final answer to my last question now, in plain prose, using the tool results you already have. Do not call more tools unless you must.";

export function isInternalUserMessage(text: string): boolean {
  return text === EMPTY_ANSWER_NUDGE;
}
