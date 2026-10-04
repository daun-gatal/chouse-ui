/**
 * Plain-language watchers (ADR 0016 §11): compile a sentence into an ordinary
 * Data Health promise draft. The UI saves it through the existing promise
 * endpoint (and its backtest), so a watcher is never a separate object type.
 */

import { runStructuredCapability } from "../ai/engine";
import { compileWatcherCapability, type CompiledWatcher } from "../ai/capabilities/observe";

export interface CompileWatcherInput {
  connectionId: string;
  text: string;
  modelId?: string;
  userId: string;
  roles: string[];
  permissions: string[];
  allowed: (database: string | null | undefined, table: string | null | undefined) => boolean;
}

export async function compileWatcher(input: CompileWatcherInput): Promise<CompiledWatcher> {
  const isAdmin = input.roles.includes("super_admin") || input.roles.includes("admin");
  return runStructuredCapability(compileWatcherCapability, { connectionId: input.connectionId, text: input.text }, {
    userId: input.userId,
    isAdmin,
    permissions: input.permissions,
    connectionId: input.connectionId,
    modelId: input.modelId,
  });
}
