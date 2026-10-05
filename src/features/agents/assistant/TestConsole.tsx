/**
 * Test console (ADR 0019 §10): run any AI feature — with its bound agent,
 * another compatible agent, or an unsaved draft — as yourself, and see the
 * rendered prompt, the task, every tool call with its agent path, and the
 * result before anything is saved.
 */

import { useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FlaskConical, Play } from "lucide-react";

import type { AgentInput, AiRegistry, TestResult, ToolCallTrace } from "@/api/aiAgents";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { EmptyState, Mono } from "@/features/observe/ui";
import { useAgentTest, useModelOptions } from "./hooks";
import { compatibleAgents, formatDuration, parseJsonInput, sampleInput } from "./lib";
import { errorMessage, Field, TEXTAREA_CLASS } from "./shared";

const BOUND = "__bound__";
const DEFAULT_MODEL = "__default__";

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: ReactElement; defaultOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xs border border-ink-500">
      <button type="button" className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] text-paper hover:bg-ink-200/40" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {title}
      </button>
      {open && <div className="border-t border-ink-500 p-3">{children}</div>}
    </div>
  );
}

function Pre({ value }: { value: unknown }): ReactElement {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[11px] text-paper">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ToolTrail({ calls }: { calls: ToolCallTrace[] }): ReactElement {
  if (calls.length === 0) return <p className="text-[12px] text-paper-faint">No tool calls.</p>;
  return (
    <ol className="space-y-2">
      {calls.map((call, i) => (
        <li key={i} className="rounded-xs border border-ink-500 bg-ink-200/20 p-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-mono text-[10px] text-paper-faint">#{i + 1}</span>
            <Mono className="text-paper">{call.name}</Mono>
            {call.agent && <span className="font-mono text-[10px] text-brand">{call.agent}</span>}
          </div>
          <Pre value={{ args: call.args, result: call.result }} />
        </li>
      ))}
    </ol>
  );
}

function ResultView({ result }: { result: TestResult }): ReactElement {
  if (result.kind === "chat") {
    return (
      <div className="space-y-3">
        <p className="text-[12px] text-paper-muted">Answered by <span className="text-paper">{result.agent.name}</span> in {formatDuration(result.durationMs)}</p>
        <Pre value={result.content} />
        <Collapsible title={`Tool calls (${result.toolCalls.length})`} defaultOpen><ToolTrail calls={result.toolCalls} /></Collapsible>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-paper-muted">
        {result.trace ? <>Ran <span className="text-paper">{result.trace.agent.name}</span> in </> : "Returned in "}{formatDuration(result.durationMs)}
      </p>
      <Collapsible title="Result" defaultOpen><Pre value={result.output} /></Collapsible>
      {result.trace && (
        <>
          <Collapsible title={`Tool calls (${result.trace.calls.length})`}><ToolTrail calls={result.trace.calls} /></Collapsible>
          <Collapsible title="System prompt (with the output contract)"><Pre value={result.trace.system} /></Collapsible>
          {result.trace.task !== null && <Collapsible title="Task message"><Pre value={result.trace.task} /></Collapsible>}
          <Collapsible title="Raw final answer"><Pre value={result.trace.raw || "(empty)"} /></Collapsible>
        </>
      )}
      {!result.trace && <p className="text-[11px] text-paper-faint">The feature answered without running its agent (a cached result or a graceful fallback).</p>}
    </div>
  );
}

export function TestConsole({ registry, draft, defaultFeatureId, canManage }: {
  registry: AiRegistry;
  /** An unsaved agent to test (from the editor); agentId is the stored row it edits, if any. */
  draft?: { agentId: string | null; agent: AgentInput };
  defaultFeatureId?: string;
  canManage: boolean;
}): ReactElement {
  const models = useModelOptions();
  const test = useAgentTest();
  const features = useMemo(() => {
    if (!draft) return registry.features;
    return registry.features.filter((f) => (draft.agent.taskTemplate === null ? f.delivery === "invoke" : f.delivery === "structured"));
  }, [draft, registry.features]);
  const [featureId, setFeatureId] = useState(() => (defaultFeatureId && features.some((f) => f.id === defaultFeatureId) ? defaultFeatureId : features[0]?.id ?? ""));
  const feature = features.find((f) => f.id === featureId);
  const [agentChoice, setAgentChoice] = useState(BOUND);
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [input, setInput] = useState(() => JSON.stringify(sampleInput(featureId), null, 2));
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);

  const agents = feature ? compatibleAgents(feature, registry) : [];

  const chooseFeature = (id: string): void => {
    setFeatureId(id);
    setAgentChoice(BOUND);
    setInput(JSON.stringify(sampleInput(id), null, 2));
    setResult(null);
  };

  const run = async (): Promise<void> => {
    if (!feature) return;
    const base = {
      featureId: feature.id,
      modelId: modelId === DEFAULT_MODEL ? undefined : modelId,
      ...(draft ? { agentId: draft.agentId, agent: draft.agent } : agentChoice === BOUND ? {} : { agentId: agentChoice }),
    };
    try {
      if (feature.delivery === "invoke") {
        if (!message.trim()) {
          toast.error("Write a message to send");
          return;
        }
        setResult(await test.mutateAsync({ ...base, messages: [{ role: "user", content: message.trim() }] }));
      } else {
        const parsed = parseJsonInput(input);
        if (!parsed.ok) {
          toast.error(`Input is not valid JSON: ${parsed.error}`);
          return;
        }
        setResult(await test.mutateAsync({ ...base, input: parsed.value }));
      }
    } catch (error) {
      setResult(null);
      toast.error(errorMessage(error, "The test run failed"));
    }
  };

  if (features.length === 0) return <EmptyState icon={FlaskConical} title="Nothing to test" body="No feature can run this agent." />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Feature">
          <Select value={featureId} onValueChange={chooseFeature}>
            <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Feature"><SelectValue /></SelectTrigger>
            <SelectContent>{features.map((f) => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {!draft && (
          <Field label="Agent">
            <Select value={agentChoice} onValueChange={setAgentChoice}>
              <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Agent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={BOUND}>Bound agent</SelectItem>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Model">
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Model"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL}>Agent's model (or the default)</SelectItem>
              {(models.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {feature?.delivery === "invoke" ? (
        <Field label="Message" hint="Runs as you, on your active connection. Read-only tools only.">
          <Textarea className={TEXTAREA_CLASS} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Who can edit connections?" />
        </Field>
      ) : (
        <Field label="Feature input (JSON)" hint="Runs as you, on your active connection, exactly as the feature would — including its access checks.">
          <Textarea className={TEXTAREA_CLASS} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
        </Field>
      )}
      <div className="flex items-center gap-2">
        <Button className={DH_PRIMARY} disabled={!canManage || test.isPending || !feature} onClick={() => void run()}>
          <Play className="mr-1.5 h-3.5 w-3.5" /> {test.isPending ? "Running…" : draft ? "Run draft" : "Run"}
        </Button>
        {!canManage && <span className="text-[11px] text-paper-faint">Testing needs ai_agents:manage.</span>}
      </div>
      {result && <ResultView result={result} />}
    </div>
  );
}
