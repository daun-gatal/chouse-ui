/**
 * Which dashboards belong to the active connection (ADR 0021 §3). A dashboard
 * is assigned to all connections or to a list; the list page shows only the
 * ones assigned to the connection the dock is on.
 */

import type { ConnectionScope, ScopeView } from "@/api/dashboards";

export function isAssignedTo(scope: ScopeView, connectionId: string | null): boolean {
  if (scope.kind === "any") return true;
  return connectionId !== null && scope.connections.some((c) => c.id === connectionId);
}

/** "All connections", or the names the viewer may see and how many others. */
export function scopeLabel(scope: ScopeView): string {
  if (scope.kind === "any") return "All connections";
  const names = scope.connections.map((c) => c.name);
  if (scope.hidden > 0) names.push(`${scope.hidden} other${scope.hidden === 1 ? "" : "s"}`);
  return names.join(", ");
}

/** A new dashboard is for the connection it is made on. */
export function scopeForNew(connectionId: string | null): ConnectionScope {
  if (connectionId === null) throw new Error("Pick a connection in the dock first: a dashboard is made for a connection");
  return { kind: "only", connectionIds: [connectionId] };
}
