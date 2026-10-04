/**
 * Runs a DDL request; if the server refuses it because it breaks dependents,
 * shows the impact and — only when the user may override and confirms —
 * retries once with `X-Schema-Override: confirm` (ADR 0016 §11).
 */

import { ApiError } from "@/api/client";
import { parsePreflightDetails, useSchemaPreflightStore } from "@/stores/schemaPreflight";

export const SCHEMA_PREFLIGHT_CODE = "SCHEMA_PREFLIGHT_BREAKS";

export async function withSchemaOverride<T>(statement: string, run: (override: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== SCHEMA_PREFLIGHT_CODE) throw error;
    const parsed = parsePreflightDetails(error.details);
    if (!parsed) throw error;
    const confirmed = await useSchemaPreflightStore.getState().ask({ statement, message: error.message, ...parsed });
    if (!confirmed) throw error;
    return run(true);
  }
}
