/**
 * TanStack Query hooks for the Data Observability Platform (ADR 0016). Every
 * read is scoped to the active connection, like Data Health; switching the
 * connection switches every screen.
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import * as agents from "@/api/agents";
import * as ctx from "@/api/context";
import * as notebooks from "@/api/notebooks";
import * as observe from "@/api/observe";
import * as remediation from "@/api/remediation";
import * as upgrades from "@/api/upgrades";
import { rbacConnectionsApi, type ClickHouseConnection } from "@/api/rbac";
import { queryKeys } from "@/hooks/useQuery";
import { useAuthStore } from "@/stores";

const REFRESH_MS = 30_000;

export const observeKeys = {
  all: ["observe"] as const,
  status: (c: string | null) => [...observeKeys.all, "status", c] as const,
  overview: (c: string | null) => [...observeKeys.all, "overview", c] as const,
  datasets: (c: string | null, q: string, state: string, criticality: string) => [...observeKeys.all, "datasets", c, q, state, criticality] as const,
  dataset: (c: string | null, db: string, table: string) => [...observeKeys.all, "dataset", c, db, table] as const,
  lineage: (c: string | null, node: string | null, depth: number, direction: string) => [...observeKeys.all, "lineage", c, node, depth, direction] as const,
  pipelines: (c: string | null, kind: string, status: string) => [...observeKeys.all, "pipelines", c, kind, status] as const,
  pipelineSamples: (c: string | null, id: string) => [...observeKeys.all, "pipeline-samples", c, id] as const,
  coverage: (c: string | null) => [...observeKeys.all, "coverage", c] as const,
  incidents: (c: string | null, status: string) => [...observeKeys.all, "incidents", c, status] as const,
  incident: (source: string, id: string) => [...observeKeys.all, "incident", source, id] as const,
  performance: (c: string | null) => [...observeKeys.all, "performance", c] as const,
  fingerprint: (c: string | null, fp: string) => [...observeKeys.all, "fingerprint", c, fp] as const,
  capacity: (c: string | null) => [...observeKeys.all, "capacity", c] as const,
};

const remediationKeys = {
  all: ["remediation"] as const,
  catalog: () => [...remediationKeys.all, "catalog"] as const,
  actions: (c: string | null, filter: string) => [...remediationKeys.all, "actions", c, filter] as const,
  credential: (c: string) => [...remediationKeys.all, "credential", c] as const,
};

const notebookKeys = {
  all: ["notebooks"] as const,
  attached: (kind: string, ref: string) => [...notebookKeys.all, kind, ref] as const,
};

const contextKeys = {
  all: ["context"] as const,
  tables: (c: string | null, q: string) => [...contextKeys.all, "tables", c, q] as const,
  table: (c: string | null, db: string, table: string) => [...contextKeys.all, "table", c, db, table] as const,
  metrics: (c: string | null) => [...contextKeys.all, "metrics", c] as const,
};

export const upgradeKeys = {
  all: ["upgrades"] as const,
  list: (c: string | null) => [...upgradeKeys.all, "list", c] as const,
  assessment: (id: string) => [...upgradeKeys.all, "assessment", id] as const,
  replay: (id: string) => [...upgradeKeys.all, "replay", id] as const,
  rollout: () => [...upgradeKeys.all, "rollout"] as const,
};

const agentKeys = {
  all: ["agents"] as const,
  summary: () => [...agentKeys.all, "summary"] as const,
  sessions: (days: number) => [...agentKeys.all, "sessions", days] as const,
  session: (id: string) => [...agentKeys.all, "session", id] as const,
  policies: () => [...agentKeys.all, "policies"] as const,
  policyScopes: () => [...agentKeys.all, "policy-scopes"] as const,
  mcp: () => [...agentKeys.all, "mcp"] as const,
};

function useConnection(): string | null {
  return useAuthStore((state) => state.activeConnectionId);
}

function cid(connectionId: string | null): string | undefined {
  return connectionId ?? undefined;
}

// --- observe ----------------------------------------------------------------------

export function useCollectorStatus(): UseQueryResult<observe.CollectorStatus> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.status(c), queryFn: () => observe.getCollectorStatus(cid(c)), enabled: Boolean(c) });
}

export function useOverview(): UseQueryResult<observe.Overview> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.overview(c), queryFn: () => observe.getOverview(cid(c)), enabled: Boolean(c), refetchInterval: REFRESH_MS });
}

export function useDatasets(q = "", state = "", criticality = ""): UseQueryResult<observe.DatasetSummary[]> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.datasets(c, q, state, criticality), queryFn: () => observe.listDatasets({ connectionId: cid(c), q, state, criticality }), enabled: Boolean(c) });
}

export function useDataset(database: string, table: string): UseQueryResult<observe.DatasetDetail> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.dataset(c, database, table), queryFn: () => observe.getDataset(database, table, cid(c)), enabled: Boolean(c && database && table) });
}

export function useLineage(node: string | null, depth: number, direction: "up" | "down" | "both"): UseQueryResult<observe.LineageGraph> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.lineage(c, node, depth, direction), queryFn: () => observe.getLineage({ connectionId: cid(c), node, depth, direction }), enabled: Boolean(c) });
}

export function usePipelines(kind = "", status = ""): UseQueryResult<observe.Pipeline[]> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.pipelines(c, kind, status), queryFn: () => observe.listPipelines({ connectionId: cid(c), kind, status }), enabled: Boolean(c), refetchInterval: REFRESH_MS });
}

export function usePipelineSamples(id: string | null): UseQueryResult<observe.PipelineSample[]> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.pipelineSamples(c, id ?? ""), queryFn: () => observe.getPipelineSamples(id ?? "", cid(c)), enabled: Boolean(c && id) });
}

export function useCoverage(): UseQueryResult<observe.Coverage> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.coverage(c), queryFn: () => observe.getCoverage(cid(c)), enabled: Boolean(c) });
}

export function useIncidents(status: "active" | "all" = "active", enabled = true): UseQueryResult<observe.UnifiedIncident[]> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.incidents(c, status), queryFn: () => observe.listIncidents({ connectionId: cid(c), status }), enabled: enabled && Boolean(c), refetchInterval: REFRESH_MS });
}

export function useIncident(source: observe.IncidentSource | null, id: string | null): UseQueryResult<observe.IncidentDetail> {
  return useQuery({ queryKey: observeKeys.incident(source ?? "", id ?? ""), queryFn: () => observe.getIncident(source ?? "observe", id ?? ""), enabled: Boolean(source && id) });
}

export function usePerformance(): UseQueryResult<observe.Performance> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.performance(c), queryFn: () => observe.getPerformance(cid(c)), enabled: Boolean(c) });
}

export function useFingerprintSeries(fingerprint: string | null): UseQueryResult<observe.FingerprintPoint[]> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.fingerprint(c, fingerprint ?? ""), queryFn: () => observe.getFingerprintSeries(fingerprint ?? "", cid(c)), enabled: Boolean(c && fingerprint) });
}

export function useCapacity(): UseQueryResult<observe.Capacity> {
  const c = useConnection();
  return useQuery({ queryKey: observeKeys.capacity(c), queryFn: () => observe.getCapacity(cid(c)), enabled: Boolean(c) });
}

export function usePinCriticality() {
  const c = useConnection();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { database: string; table: string; criticality: observe.Criticality | null }) => observe.pinCriticality(input.database, input.table, input.criticality, cid(c)),
    onSuccess: () => client.invalidateQueries({ queryKey: observeKeys.all }),
  });
}

export function useDismissSuggestion() {
  const c = useConnection();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => observe.dismissSuggestion(key, cid(c)),
    onSuccess: () => client.invalidateQueries({ queryKey: observeKeys.coverage(c) }),
  });
}

export function useRecomputeRca() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { source: observe.IncidentSource; id: string }) => observe.recomputeRca(input.source, input.id),
    onSuccess: (_data, input) => client.invalidateQueries({ queryKey: observeKeys.incident(input.source, input.id) }),
  });
}

export function useAcknowledgeObserveIncident() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => observe.acknowledgeObserveIncident(id),
    onSuccess: () => client.invalidateQueries({ queryKey: observeKeys.all }),
  });
}

export function useStartCodecTrial() {
  const c = useConnection();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { database: string; table: string; column: string; candidateCodec: string }) => observe.startCodecTrial(input, cid(c)),
    onSuccess: () => client.invalidateQueries({ queryKey: observeKeys.capacity(c) }),
  });
}

export function useSetCostRates() {
  const c = useConnection();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rates: { currency: string; perTibRead: number; perCpuHour: number }) => observe.setCostRates(rates),
    onSuccess: () => client.invalidateQueries({ queryKey: observeKeys.capacity(c) }),
  });
}

// --- remediation ------------------------------------------------------------------

export function useRemediationCatalog(enabled = true): UseQueryResult<remediation.Catalog> {
  return useQuery({ queryKey: remediationKeys.catalog(), queryFn: remediation.getCatalog, enabled, staleTime: 5 * 60_000 });
}

export function useRemediationActions(filter: { incidentId?: string; notebookId?: string; status?: remediation.ActionStatus[] } = {}, enabled = true): UseQueryResult<remediation.RemediationAction[]> {
  const c = useConnection();
  const key = JSON.stringify(filter);
  return useQuery({
    queryKey: remediationKeys.actions(c, key),
    queryFn: () => remediation.listActions({ connectionId: c ?? "", ...filter }),
    enabled: enabled && Boolean(c),
    refetchInterval: REFRESH_MS,
  });
}

function useRemediationMutation<TInput>(fn: (input: TInput) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: remediationKeys.all }) });
}

export function useProposeAction() {
  return useRemediationMutation((input: remediation.ProposeInput) => remediation.proposeAction(input));
}

export function useDecideAction() {
  return useRemediationMutation((input: { id: string; decision: "approve" | "reject"; comment?: string | null }) =>
    input.decision === "approve" ? remediation.approveAction(input.id, input.comment) : remediation.rejectAction(input.id, input.comment));
}

export function useRunAction() {
  return useRemediationMutation((id: string) => remediation.runAction(id));
}

export function useRollbackAction() {
  return useRemediationMutation((id: string) => remediation.rollbackAction(id));
}

export function useRemediationCredential(connectionId: string | null, enabled = true): UseQueryResult<Awaited<ReturnType<typeof remediation.getCredential>>> {
  return useQuery({ queryKey: remediationKeys.credential(connectionId ?? ""), queryFn: () => remediation.getCredential(connectionId ?? ""), enabled: enabled && Boolean(connectionId) });
}

export function useSaveRemediationCredential() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { connectionId: string; username: string; password: string } | { connectionId: string; remove: true }) =>
      "remove" in input ? remediation.deleteCredential(input.connectionId) : remediation.setCredential(input.connectionId, input.username, input.password),
    onSuccess: (_data, input) => client.invalidateQueries({ queryKey: remediationKeys.credential(input.connectionId) }),
  });
}

// --- notebooks --------------------------------------------------------------------

export function useAttachedNotebook(kind: notebooks.NotebookAttachment, ref: string | null, title?: string): UseQueryResult<notebooks.NotebookWithCells> {
  return useQuery({ queryKey: notebookKeys.attached(kind, ref ?? ""), queryFn: () => notebooks.ensureNotebook(kind, ref ?? "", title), enabled: Boolean(ref) });
}

export function useNotebookMutations(kind: notebooks.NotebookAttachment, ref: string) {
  const client = useQueryClient();
  const invalidate = (): Promise<void> => client.invalidateQueries({ queryKey: notebookKeys.attached(kind, ref) });
  return {
    add: useMutation({ mutationFn: (input: { notebookId: string; cell: notebooks.NewCell }) => notebooks.addCell(input.notebookId, input.cell), onSuccess: invalidate }),
    rerun: useMutation({ mutationFn: (input: { notebookId: string; cellId: string }) => notebooks.rerunCell(input.notebookId, input.cellId), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (input: { notebookId: string; cellId: string }) => notebooks.deleteCell(input.notebookId, input.cellId), onSuccess: invalidate }),
  };
}

// --- context ----------------------------------------------------------------------

export function useContextTables(q = ""): UseQueryResult<Awaited<ReturnType<typeof ctx.listContextTables>>> {
  const c = useConnection();
  return useQuery({ queryKey: contextKeys.tables(c, q), queryFn: () => ctx.listContextTables(q, cid(c)), enabled: Boolean(c) });
}

export function useTableContext(database: string | null, table: string | null): UseQueryResult<ctx.TableContext> {
  const c = useConnection();
  return useQuery({ queryKey: contextKeys.table(c, database ?? "", table ?? ""), queryFn: () => ctx.getTableContext(database ?? "", table ?? "", cid(c)), enabled: Boolean(c && database && table) });
}

export function useMetrics(): UseQueryResult<ctx.Metric[]> {
  const c = useConnection();
  return useQuery({ queryKey: contextKeys.metrics(c), queryFn: () => ctx.listMetrics(cid(c)), enabled: Boolean(c) });
}

export function useContextMutations() {
  const c = useConnection();
  const client = useQueryClient();
  const invalidate = (): Promise<void> => client.invalidateQueries({ queryKey: contextKeys.all });
  return {
    save: useMutation({ mutationFn: (input: { database: string; table: string; curated: ctx.CuratedContext }) => ctx.saveTableContext(input.database, input.table, input.curated, cid(c)), onSuccess: invalidate }),
    verify: useMutation({ mutationFn: (input: { database: string; table: string }) => ctx.verifyTableContext(input.database, input.table, cid(c)), onSuccess: invalidate }),
    saveMetric: useMutation({ mutationFn: (input: { database: string; table: string; metric: { name: string; expression: string; description?: string | null; owner?: string | null } }) => ctx.saveMetric(input.database, input.table, input.metric, cid(c)), onSuccess: invalidate }),
    deleteMetric: useMutation({ mutationFn: (id: string) => ctx.deleteMetric(id, cid(c)), onSuccess: invalidate }),
    importDbt: useMutation({ mutationFn: (manifest: unknown) => ctx.importDbtManifest(manifest, cid(c)), onSuccess: invalidate }),
    compileWatcher: useMutation({ mutationFn: (input: { text: string; modelId?: string }) => ctx.compileWatcher(input.text, input.modelId, cid(c)) }),
    draft: useMutation({ mutationFn: (input: { database: string; table: string; modelId?: string }) => ctx.draftTableContext(input.database, input.table, input.modelId, cid(c)) }),
  };
}

// --- upgrades ---------------------------------------------------------------------

export function useUpgrades(): UseQueryResult<Awaited<ReturnType<typeof upgrades.listAssessments>>> {
  const c = useConnection();
  return useQuery({ queryKey: upgradeKeys.list(c), queryFn: () => upgrades.listAssessments(cid(c)), enabled: Boolean(c) });
}

export function useAssessment(id: string | null): UseQueryResult<upgrades.Assessment> {
  return useQuery({ queryKey: upgradeKeys.assessment(id ?? ""), queryFn: () => upgrades.getAssessment(id ?? ""), enabled: Boolean(id) });
}

export function useReplay(id: string | null): UseQueryResult<upgrades.Replay> {
  return useQuery({
    queryKey: upgradeKeys.replay(id ?? ""),
    queryFn: () => upgrades.getReplay(id ?? ""),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5_000 : false),
  });
}

export function useRollout(): UseQueryResult<upgrades.RolloutNode[]> {
  return useQuery({ queryKey: upgradeKeys.rollout(), queryFn: upgrades.getRollout });
}

export function useUpgradeMutations() {
  const c = useConnection();
  const client = useQueryClient();
  const invalidate = (): Promise<void> => client.invalidateQueries({ queryKey: upgradeKeys.all });
  return {
    assess: useMutation({ mutationFn: (targetVersion: string) => upgrades.runAssessment(targetVersion, cid(c)), onSuccess: invalidate }),
    replay: useMutation({ mutationFn: (input: { canaryConnectionId: string; assessmentId: string | null }) => upgrades.startReplay(input.canaryConnectionId, input.assessmentId, cid(c)), onSuccess: invalidate }),
  };
}

// --- agents -----------------------------------------------------------------------

export function useAgentSummary(enabled = true): UseQueryResult<agents.AgentSummary> {
  return useQuery({ queryKey: agentKeys.summary(), queryFn: agents.getAgentSummary, refetchInterval: REFRESH_MS, enabled });
}

export function useAgentSessions(days: number): UseQueryResult<agents.AgentSession[]> {
  return useQuery({ queryKey: agentKeys.sessions(days), queryFn: () => agents.listAgentSessions(days), refetchInterval: REFRESH_MS });
}

export function useAgentSession(id: string | null): UseQueryResult<Awaited<ReturnType<typeof agents.getAgentSession>>> {
  return useQuery({ queryKey: agentKeys.session(id ?? ""), queryFn: () => agents.getAgentSession(id ?? ""), enabled: Boolean(id) });
}

export function useAgentPolicies(enabled = true): UseQueryResult<agents.AgentPolicy[]> {
  return useQuery({ queryKey: agentKeys.policies(), queryFn: agents.listAgentPolicies, enabled });
}

export function useAgentPolicyScopes(enabled = true): UseQueryResult<agents.PolicyScopes> {
  return useQuery({ queryKey: agentKeys.policyScopes(), queryFn: agents.listPolicyScopes, enabled });
}

export function useAgentMutations() {
  const client = useQueryClient();
  const invalidate = (): Promise<void> => client.invalidateQueries({ queryKey: agentKeys.all });
  return {
    assignPolicy: useMutation({ mutationFn: (input: Parameters<typeof agents.assignAgentPolicy>[0]) => agents.assignAgentPolicy(input), onSuccess: invalidate }),
    deletePolicy: useMutation({ mutationFn: (id: string) => agents.deleteAgentPolicy(id), onSuccess: invalidate }),
    pause: useMutation({ mutationFn: (paused: boolean) => agents.setAgentsPaused(paused), onSuccess: invalidate }),
  };
}

export function useMcpOverview(enabled = true): UseQueryResult<agents.McpOverview> {
  return useQuery({ queryKey: agentKeys.mcp(), queryFn: agents.getMcpOverview, enabled });
}

export function useUpdateMcpSettings(): UseMutationResult<agents.McpOverview, Error, agents.McpSettingsUpdate> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (update: agents.McpSettingsUpdate) => agents.updateMcpSettings(update),
    onSuccess: (overview) => {
      client.setQueryData(agentKeys.mcp(), overview);
      // The dock and the token card read the on/off state from /config.
      void client.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

// --- connections ------------------------------------------------------------------

/** Connections the user may use (EXPLAIN compare, canary replay). */
export function useMyConnections(enabled = true): UseQueryResult<ClickHouseConnection[]> {
  return useQuery({ queryKey: ["connections", "mine"], queryFn: () => rbacConnectionsApi.getMyConnections(), enabled, staleTime: 60_000 });
}

/**
 * Display name of a connection. The active one comes from the session; any
 * other is looked up, so a raw connection id is never shown.
 */
export function useConnectionName(connectionId: string | null | undefined): string | null {
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const activeConnectionName = useAuthStore((s) => s.activeConnectionName);
  const isActive = Boolean(connectionId) && connectionId === activeConnectionId && Boolean(activeConnectionName);
  const { data, isLoading } = useMyConnections(Boolean(connectionId) && !isActive);
  if (!connectionId) return null;
  if (isActive) return activeConnectionName;
  if (isLoading) return "Loading…";
  return data?.find((c) => c.id === connectionId)?.name ?? "Unknown connection";
}
