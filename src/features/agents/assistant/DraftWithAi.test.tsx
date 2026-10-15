import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { AgentInput, AiRegistry, DraftResult, SectionStatus, SkillInput } from "@/api/aiAgents";
import { server } from "@/test/mocks/server";
import { AgentEditor } from "./AgentEditor";
import { AgentsView } from "./RegistryViews";
import { SkillsView } from "./SkillsView";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const meta = { isSystem: false, seedHash: null, customized: false, version: 1, createdBy: null, createdAt: 0, updatedAt: 0, updateAvailable: false, usedBy: [] };

function registry(drafting = true): AiRegistry {
  return {
    version: 1,
    features: [],
    agents: [],
    harnesses: [{ id: "h-focused", slug: "focused", name: "Focused", description: "", excludedTools: [], generalPurpose: { enabled: false }, promptSuffix: null, toolDescriptionOverrides: {}, ...meta, isSystem: true }],
    skills: [],
    tools: [{ name: "list_tables", title: "List tables", domain: "clickhouse", category: "schema", access: "read", requires: "session", permissions: [], description: "List tables" }],
    builtinTools: [],
    contexts: ["session", "fleet", "userApi"],
    limits: { stepBudget: { min: 1, max: 100 }, recursionLimit: { min: 8, max: 1000 }, timeoutMs: { min: 5000, max: 1800000 }, maxOutputTokens: { min: 256, max: 200000 } },
    problems: [],
    drafting: { agent: drafting, harness: drafting, skill: drafting },
  };
}

const status = (state: SectionStatus["state"], problems: string[] = [], reason: string | null = null): SectionStatus => ({ state, reason, problems, rationale: [] });

const skillInput: SkillInput = {
  path: "custom/too-many-parts",
  skillMd: "---\nname: too-many-parts\ndescription: \"Use when inserts fail with TOO_MANY_PARTS.\"\n---\n\n## When to use\n…",
  files: {},
  enabled: true,
};

function skillDraft(sections: Record<string, SectionStatus>, input: SkillInput = skillInput): DraftResult<SkillInput> {
  return { kind: "skill", mode: "draft", input, sections, meta: { reasons: {}, rationale: {} }, summary: "Parts triage skill.", fixes: ["Path 'parts' was changed to 'custom/too-many-parts'"], problems: [], suggestedSkills: [], rounds: 1 };
}

describe("Draft with AI", () => {
  it("hides the action when no model can draft", () => {
    render(<SkillsView registry={registry(false)} canManage />, { wrapper });
    expect(screen.queryByRole("button", { name: /draft with ai/i })).toBeNull();
    expect(screen.getByRole("button", { name: /new skill/i })).toBeTruthy();
  });

  it("drafts a skill and opens it in the editor with the review banner", async () => {
    const requests: unknown[] = [];
    server.use(http.post("/api/ai-agents/draft/skill", async ({ request }) => {
      requests.push(await request.json());
      return HttpResponse.json({ success: true, data: skillDraft({ path: status("drafted"), skillMd: status("drafted"), files: status("empty", [], "Short enough to keep in SKILL.md."), enabled: status("drafted") }) });
    }));
    render(<SkillsView registry={registry()} canManage />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /draft with ai/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/what should the agent know/i), { target: { value: "Triage TOO_MANY_PARTS errors" } });
    fireEvent.change(within(dialog).getByLabelText("Reference material"), { target: { value: "Runbook text" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Draft" }));

    expect(await screen.findByText(/Drafted by AI — review before saving/)).toBeTruthy();
    expect(requests[0]).toEqual({ goal: "Triage TOO_MANY_PARTS errors", reference: "Runbook text" });
    expect((screen.getByLabelText("Skill path") as HTMLInputElement).value).toBe("custom/too-many-parts");
    expect(screen.getByText(/Short enough to keep in SKILL.md/)).toBeTruthy();
    expect(screen.getByText(/Adjusted to fit the registry/)).toBeTruthy();
  });

  it("redrafts one section and warns before saving a draft that still needs attention", async () => {
    const redrafts: unknown[] = [];
    const saves: unknown[] = [];
    let call = 0;
    server.use(
      http.post("/api/ai-agents/draft/skill", async ({ request }) => {
        call += 1;
        const body = await request.json();
        if (call === 1) return HttpResponse.json({ success: true, data: skillDraft({ path: status("drafted"), skillMd: status("attention", ["SKILL.md does not cover pitfalls"]), files: status("drafted"), enabled: status("drafted") }) });
        redrafts.push(body);
        return HttpResponse.json({ success: true, data: skillDraft({ path: status("drafted"), skillMd: status("attention", ["SKILL.md does not cover examples"]), files: status("drafted"), enabled: status("drafted") }, { ...skillInput, skillMd: `${skillInput.skillMd}\n## Pitfalls\nAvoid OPTIMIZE FINAL.` }) });
      }),
      http.post("/api/ai-agents/skills", async ({ request }) => {
        saves.push(await request.json());
        return HttpResponse.json({ success: true, data: { ...skillInput, ...meta, id: "s1", name: "too-many-parts", description: "d" } });
      }),
    );
    render(<SkillsView registry={registry()} canManage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /draft with ai/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/what should the agent know/i), { target: { value: "Triage TOO_MANY_PARTS errors" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Draft" }));

    const review = await screen.findByLabelText("SKILL.md review");
    expect(within(review).getByText(/does not cover pitfalls/)).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: /redraft this section/i }));
    await waitFor(() => expect(redrafts).toHaveLength(1));
    expect(redrafts[0]).toMatchObject({ goal: "Triage TOO_MANY_PARTS errors", sections: ["skillMd"], feedback: { skillMd: ["SKILL.md does not cover pitfalls"] }, current: skillInput });
    await waitFor(() => expect((screen.getByLabelText("SKILL.md") as HTMLTextAreaElement).value).toContain("## Pitfalls"));

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/still need attention/)).toBeTruthy();
    expect(screen.getByText(/SKILL.md: SKILL.md does not cover examples/)).toBeTruthy();
    expect(saves).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(saves).toHaveLength(1));
  });

  it("opens a drafted agent in the editor with a status on every tab", async () => {
    const onEdit = vi.fn();
    const agentInput: AgentInput = {
      slug: "table-size-analyst", name: "Table Size Analyst", description: "Answers table size questions.", kind: "agent",
      systemPrompt: "You are…", taskTemplate: null, modelConfigId: null, harnessId: "h-focused",
      tuning: { stepBudget: 6, recursionLimit: null, timeoutMs: null, maxOutputTokens: null },
      requiredPermissions: [], tools: ["list_tables"], skills: [], subagents: [], enabled: false,
    };
    const result: DraftResult<AgentInput> = {
      kind: "agent", mode: "draft", input: agentInput,
      sections: {
        identity: status("drafted"), prompt: status("attention", ["System prompt is too short"]), tools: status("drafted"),
        skills: status("empty", [], "No skill fits."), subagents: status("empty", [], "Single-purpose."), settings: status("drafted"),
      },
      meta: { reasons: {}, rationale: {} }, summary: "", fixes: [], problems: [], suggestedSkills: ["TTL tuning"], rounds: 3,
    };
    server.use(http.post("/api/ai-agents/draft/agent", () => HttpResponse.json({ success: true, data: result })));
    render(<AgentsView registry={registry()} canManage onEdit={onEdit} />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /draft with ai/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/what should this agent do/i), { target: { value: "Explain table sizes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Draft" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    const target = onEdit.mock.calls[0][0];
    expect(target).toMatchObject({ agent: null, initial: agentInput, aiDraft: result, origin: { goal: "Explain table sizes", agentHints: { featureId: null, delegate: "auto" } } });

    render(<AgentEditor registry={registry()} target={target} canManage onClose={vi.fn()} onOpenAgent={vi.fn()} />, { wrapper });
    expect(await screen.findByText(/Drafted by AI — review before saving/)).toBeTruthy();
    expect(screen.getByText(/Skills worth drafting next: TTL tuning/)).toBeTruthy();
    const promptTab = screen.getByRole("tab", { name: /prompt/i });
    expect(within(promptTab).getByLabelText("Needs attention")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /skills/i })).getByLabelText("Empty on purpose")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /tools/i })).getByLabelText("Drafted")).toBeTruthy();
    expect(screen.getByLabelText("Refine instruction")).toBeTruthy();
  });
});
