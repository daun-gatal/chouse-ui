/**
 * Context AI draft: fill the curated-context form for one table. Nothing is
 * stored here; the UI shows the draft in the form and a person saves it
 * through the ordinary context endpoint.
 */

import { runStructuredCapability } from "../ai/engine";
import { draftTableContextCapability, type TableContextDraft } from "../ai/capabilities/observe";

export interface DraftTableContextInput {
  connectionId: string;
  database: string;
  table: string;
  modelId?: string;
  userId: string;
  roles: string[];
  permissions: string[];
}

export async function draftTableContext(input: DraftTableContextInput): Promise<TableContextDraft> {
  const isAdmin = input.roles.includes("super_admin") || input.roles.includes("admin");
  return runStructuredCapability(draftTableContextCapability, { connectionId: input.connectionId, database: input.database, table: input.table }, {
    userId: input.userId,
    isAdmin,
    permissions: input.permissions,
    connectionId: input.connectionId,
    modelId: input.modelId,
  });
}
