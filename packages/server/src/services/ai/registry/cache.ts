/**
 * Per-process registry snapshot, keyed on `ai_registry_state.version`.
 *
 * Each call reads the one-row version counter; a snapshot is reused only while
 * the counter is unchanged, so an edit on any replica reaches every replica on
 * its next request (ADR 0010 — no pod-local authority, only a pod-local copy).
 */

import { getRegistryVersion, loadSnapshot } from "./store";
import type { RegistrySnapshot } from "./types";

let cached: RegistrySnapshot | null = null;
let loading: Promise<RegistrySnapshot> | null = null;

export async function getRegistrySnapshot(): Promise<RegistrySnapshot> {
  const version = await getRegistryVersion();
  if (cached && cached.version === version) return cached;
  if (!loading) {
    loading = loadSnapshot()
      .then((snapshot) => {
        cached = snapshot;
        return snapshot;
      })
      .finally(() => {
        loading = null;
      });
  }
  const snapshot = await loading;
  // A write that landed while we were loading makes this snapshot older than the
  // counter we read; load again so the caller never acts on a stale registry.
  return snapshot.version >= version ? snapshot : loadSnapshot();
}

/** Drop the cached snapshot (tests, and after a seed sync in the same process). */
export function resetRegistryCache(): void {
  cached = null;
}
