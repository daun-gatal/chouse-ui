/**
 * Agents › Assistant list views: every AI feature with its bound agent, the
 * agent tree, and the read-only tool catalog.
 */

import { Fragment, type ReactElement } from "react";
import { toast } from "sonner";
import { Bot, Pencil, Plus } from "lucide-react";

import { agentInputOf, type AiAgent, type AiRegistry } from "@/api/aiAgents";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, EmptyState, Mono, Panel, StatusPill } from "@/features/observe/ui";
import type { AgentEditorTarget } from "./AgentEditor";
import { useAssistantMutations } from "./hooks";
import { agentTree, blankAgent, compatibleAgents, CONTEXT_LABELS, groupFeatures, groupTools, problemsFor, type AgentTreeNode } from "./lib";
import { ContextBadge, errorMessage, OriginBadge } from "./shared";

function agentName(registry: AiRegistry, id: string | null): string {
  return registry.agents.find((a) => a.id === id)?.name ?? "No agent";
}

export function FeaturesView({ registry, canManage, onEdit }: { registry: AiRegistry; canManage: boolean; onEdit: (target: AgentEditorTarget) => void }): ReactElement {
  const { bind } = useAssistantMutations();
  const rebind = async (featureId: string, agentId: string): Promise<void> => {
    try {
      await bind.mutateAsync({ featureId, agentId });
      toast.success(`Bound to ${agentName(registry, agentId)}`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not rebind the feature"));
    }
  };
  return (
    <div className="space-y-4">
      {groupFeatures(registry.features).map((group) => (
        <Panel key={group.surface} title={group.label} meta={`${group.features.length} feature${group.features.length === 1 ? "" : "s"}`}>
          <DataTable label={`${group.label} features`} head={["Feature", "Runs with", "Agent", "Status", ""]}>
            {group.features.map((feature) => {
              const agent = registry.agents.find((a) => a.id === feature.agentId) ?? null;
              const problems = problemsFor(registry.problems, "binding", feature.id);
              const options = compatibleAgents(feature, registry);
              const choices = agent && !options.includes(agent) ? [agent, ...options] : options;
              return (
                <tr key={feature.id}>
                  <td className="max-w-md">
                    <span className="block text-[12px] text-paper">{feature.title}</span>
                    <span className="block text-[11px] text-paper-faint">{feature.description}</span>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {feature.contexts.length === 0 ? <span className="text-[11px] text-paper-faint">Evidence only</span> : feature.contexts.map((c) => <ContextBadge key={c} kind={c} />)}
                    </div>
                  </td>
                  <td>
                    {canManage ? (
                      <Select value={feature.agentId ?? ""} onValueChange={(v) => void rebind(feature.id, v)} disabled={bind.isPending}>
                        <SelectTrigger className="h-8 w-56 rounded-xs text-[11px]" aria-label={`Agent for ${feature.title}`}><SelectValue placeholder="Pick an agent" /></SelectTrigger>
                        <SelectContent>{choices.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : <span className="text-[12px] text-paper">{agentName(registry, feature.agentId)}</span>}
                  </td>
                  <td>
                    {problems.length > 0
                      ? <StatusPill tone="bad">{problems[0]}</StatusPill>
                      : agent ? <OriginBadge row={agent} /> : <StatusPill tone="bad">unbound</StatusPill>}
                  </td>
                  <td className="text-right">
                    {agent && (
                      <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px]" onClick={() => onEdit({ agent, initial: agentInputOf(agent), featureId: feature.id })}>
                        <Pencil className="mr-1 h-3 w-3" /> {canManage ? "Edit agent" : "View agent"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </Panel>
      ))}
    </div>
  );
}

function TreeRows({ node, depth, registry, onEdit }: { node: AgentTreeNode; depth: number; registry: AiRegistry; onEdit: (target: AgentEditorTarget) => void }): ReactElement {
  const { agent } = node;
  const problems = problemsFor(registry.problems, "agent", agent.id);
  const harness = registry.harnesses.find((h) => h.id === agent.harnessId);
  return (
    <Fragment>
      <tr className="cursor-pointer hover:bg-ink-200/50" onClick={() => onEdit({ agent, initial: agentInputOf(agent) })}>
        <td>
          <div className="flex items-start gap-2" style={{ paddingLeft: depth * 18 }}>
            {depth > 0 && <span className="font-mono text-[10px] leading-5 text-paper-faint">└</span>}
            <div>
              <span className="flex items-center gap-2">
                <button type="button" className="text-left text-[12px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); onEdit({ agent, initial: agentInputOf(agent) }); }}>{agent.name}</button>
                {agent.kind === "router" && <StatusPill tone="info" dot={false}>router</StatusPill>}
              </span>
              <Mono className="block text-[10px] text-paper-faint">{agent.slug}</Mono>
            </div>
          </div>
        </td>
        <td className="text-[11px] text-paper-muted">{agent.taskTemplate === null ? "Chat / subagent" : "Feature"}</td>
        <td className="text-[11px] text-paper-muted">{harness?.name ?? "—"}</td>
        <td className="tabular-nums text-[11px] text-paper-muted">{agent.tools.length}</td>
        <td className="text-[11px] text-paper-muted">{agent.usedBy.length > 0 ? agent.usedBy.join(", ") : "—"}</td>
        <td>
          <span className="inline-flex flex-wrap items-center gap-1">
            <OriginBadge row={agent} />
            {!agent.enabled && <StatusPill tone="muted" dot={false}>disabled</StatusPill>}
            {problems.length > 0 && <StatusPill tone="bad">{problems.length} problem{problems.length === 1 ? "" : "s"}</StatusPill>}
          </span>
        </td>
      </tr>
      {node.children.map((child) => <TreeRows key={`${agent.id}>${child.agent.id}`} node={child} depth={depth + 1} registry={registry} onEdit={onEdit} />)}
    </Fragment>
  );
}

export function AgentsView({ registry, canManage, onEdit }: { registry: AiRegistry; canManage: boolean; onEdit: (target: AgentEditorTarget) => void }): ReactElement {
  const tree = agentTree(registry);
  return (
    <Panel
      title="Agents"
      meta="Routers and top-level agents, with their subagents below them"
      actions={canManage ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => onEdit({ agent: null, initial: blankAgent(registry) })}><Plus className="mr-1 h-3 w-3" /> New agent</Button> : undefined}
    >
      {tree.length === 0 ? <EmptyState icon={Bot} title="No agents" /> : (
        <DataTable label="Agents" head={["Agent", "Type", "Harness", "Tools", "Used by", "Status"]}>
          {tree.map((node) => <TreeRows key={node.agent.id} node={node} depth={0} registry={registry} onEdit={onEdit} />)}
        </DataTable>
      )}
    </Panel>
  );
}

function usersOfTool(name: string, agents: AiAgent[]): string[] {
  return agents.filter((a) => a.tools.includes(name)).map((a) => a.name);
}

export function ToolsView({ registry }: { registry: AiRegistry }): ReactElement {
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-paper-muted">
        Tools are defined in code — they decide what runs and as whom — and every one is read-only. Agents choose from this catalog.
        Contexts: {Object.values(CONTEXT_LABELS).join(" · ")}.
      </p>
      {groupTools(registry.tools).map((group) => (
        <Panel key={group.key} title={group.label} meta={`${group.tools.length} tools`}>
          <DataTable label={group.label} head={["Tool", "Needs", "Permissions", "Used by"]}>
            {group.tools.map((tool) => (
              <tr key={tool.name}>
                <td className="max-w-lg">
                  <Mono className="text-paper">{tool.name}</Mono>
                  <span className="block text-[11px] text-paper-faint">{tool.description.split("\n")[0]}</span>
                </td>
                <td>{tool.requires ? <ContextBadge kind={tool.requires} /> : <span className="text-[11px] text-paper-faint">nothing</span>}</td>
                <td className="font-mono text-[10px] text-paper-muted">{tool.permissions.length > 0 ? tool.permissions.join(", ") : "—"}</td>
                <td className="text-[11px] text-paper-muted">{usersOfTool(tool.name, registry.agents).join(", ") || "—"}</td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      ))}
    </div>
  );
}
