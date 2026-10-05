import type { CuratedContext, TableContextDraft } from "@/api/context";

export type DraftField = "description" | "grain" | "owner" | "insteadOf" | "tags" | "deprecated";

export interface DraftedForm {
  form: CuratedContext;
  tags: string;
  filled: DraftField[];
}

const TEXT_FIELDS = ["description", "grain", "owner", "insteadOf"] as const;

/**
 * Merge a Chouse AI draft into the curated form without overwriting anything a
 * person wrote: only empty fields (and an unticked "deprecated") are filled.
 */
export function applyContextDraft(form: CuratedContext, tags: string, draft: TableContextDraft["draft"]): DraftedForm {
  const next: CuratedContext = { ...form };
  const filled: DraftField[] = [];
  for (const key of TEXT_FIELDS) {
    const suggestion = draft[key];
    if (!(form[key] ?? "").trim() && suggestion) {
      next[key] = suggestion;
      filled.push(key);
    }
  }
  let nextTags = tags;
  if (!tags.trim() && draft.tags.length > 0) {
    nextTags = draft.tags.join(", ");
    filled.push("tags");
  }
  if (!form.deprecated && draft.deprecated) {
    next.deprecated = true;
    filled.push("deprecated");
  }
  return { form: next, tags: nextTags, filled };
}
