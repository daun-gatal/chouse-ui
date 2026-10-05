/**
 * Agents › Assistant (ADR 0019): every built-in AI agent — the chat and every
 * AI feature — with its harness, skills and tools, managed in the UI.
 * Viewing needs ai_agents:view; changing or testing needs ai_agents:manage.
 */

import { useState, type ReactElement } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, Kpi, LoadingGrid, Panel } from "@/features/observe/ui";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { AgentEditor, type AgentEditorTarget } from "./AgentEditor";
import { HarnessesView } from "./HarnessesView";
import { useAiRegistry } from "./hooks";
import { AgentsView, FeaturesView, ToolsView } from "./RegistryViews";
import { TAB_CLASS } from "./shared";
import { SkillsView } from "./SkillsView";
import { TestConsole } from "./TestConsole";

const VIEWS = [
  { key: "features", label: "Features" },
  { key: "agents", label: "Agents" },
  { key: "harnesses", label: "Harnesses" },
  { key: "skills", label: "Skills" },
  { key: "tools", label: "Tools" },
  { key: "test", label: "Test console" },
] as const;

export function AssistantPanel(): ReactElement {
  const canManage = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_AGENTS_MANAGE));
  const registry = useAiRegistry();
  const [editing, setEditing] = useState<AgentEditorTarget | null>(null);

  if (registry.isLoading) return <LoadingGrid count={4} />;
  if (registry.isError || !registry.data) return <ErrorState title="The AI agent registry could not be loaded." error={registry.error} />;
  const data = registry.data;
  const customized = data.agents.filter((a) => a.customized).length;
  const updates = [...data.agents, ...data.harnesses, ...data.skills].filter((r) => r.updateAvailable).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="AI features" value={data.features.length} meta="Each runs on one agent" />
        <Kpi label="Agents" value={data.agents.length} meta={`${data.agents.filter((a) => !a.isSystem).length} added here`} />
        <Kpi label="Customized built-ins" value={customized} meta={updates > 0 ? `${updates} with a CHouse update` : "Reset any time"} tone={updates > 0 ? "warn" : undefined} />
        <Kpi label="Problems" value={data.problems.length} meta={data.problems.length > 0 ? "Fix before the feature runs" : "Everything is wired"} tone={data.problems.length > 0 ? "bad" : undefined} />
      </div>
      {data.problems.length > 0 && (
        <Panel title="Problems" meta="A feature with a problem fails closed with an error until it is fixed">
          <ul className="space-y-1 text-[12px] text-red-400">{data.problems.map((p, i) => <li key={i}>• {p.message}</li>)}</ul>
        </Panel>
      )}
      <Tabs defaultValue="features">
        <TabsList className="h-9 rounded-xs bg-ink-200/40">
          {VIEWS.map((v) => <TabsTrigger key={v.key} value={v.key} className={TAB_CLASS}>{v.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="features" className="mt-4"><FeaturesView registry={data} canManage={canManage} onEdit={setEditing} /></TabsContent>
        <TabsContent value="agents" className="mt-4"><AgentsView registry={data} canManage={canManage} onEdit={setEditing} /></TabsContent>
        <TabsContent value="harnesses" className="mt-4"><HarnessesView registry={data} canManage={canManage} /></TabsContent>
        <TabsContent value="skills" className="mt-4"><SkillsView registry={data} canManage={canManage} /></TabsContent>
        <TabsContent value="tools" className="mt-4"><ToolsView registry={data} /></TabsContent>
        <TabsContent value="test" className="mt-4">
          <Panel title="Test console" meta="Runs as you, on your active connection"><TestConsole registry={data} canManage={canManage} /></Panel>
        </TabsContent>
      </Tabs>
      {editing && (
        <AgentEditor
          key={`${editing.agent?.id ?? "new"}:${editing.agent?.version ?? 0}:${editing.initial.slug}`}
          registry={data}
          target={editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onOpenAgent={setEditing}
        />
      )}
    </div>
  );
}
