import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { Guardrail, GuardrailCatalog, GuardrailEvent } from "@/api/aiGuardrails";
import { server } from "@/test/mocks/server";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { GuardrailsPanel } from "./GuardrailsPanel";

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>;
}

const TEXT = ["log", "warn", "redact", "block"] as const;
const pii: Guardrail = {
  id: "builtin-guardrail-pii", slug: "pii-redaction", name: "PII redaction", description: "Emails and cards", kind: "pattern",
  config: { detectors: ["email"], patterns: [], strategy: "placeholder" }, stages: ["tool_result"], action: "redact", mode: "enforce",
  scope: { agents: "all", features: "all", mcp: true }, position: 20, enabled: true, isSystem: true, seedHash: "x", customized: false,
  version: 1, createdBy: null, createdAt: 0, updatedAt: 0, updateAvailable: false, triggers24h: { total: 12, applied: 12, blocked: 0 },
};

const catalog: GuardrailCatalog = {
  version: 1,
  guardrails: [pii],
  kinds: {
    pattern: { label: "Pattern match", description: "Regexes and detectors", stages: { input: [...TEXT], tool_call: ["log", "warn", "block"], tool_result: [...TEXT], output: [...TEXT] } },
    keywords: { label: "Keyword list", description: "Terms", stages: { input: [...TEXT], tool_result: [...TEXT], output: [...TEXT] } },
    columns: { label: "Column masking", description: "Columns", stages: { tool_result: ["log", "redact", "block"] } },
    injection: { label: "Prompt-injection shield", description: "Injection", stages: { tool_result: ["log", "warn", "block"] } },
    sql: { label: "SQL safety", description: "SQL", stages: { tool_call: ["log", "warn", "block"] } },
    tool: { label: "Tool policy", description: "Tools", stages: { tool_call: ["log", "warn", "block"] } },
    limits: { label: "Limits", description: "Limits", stages: { tool_call: ["log", "warn", "block"], tool_result: ["log", "redact", "block"] } },
    judge: { label: "AI judge", description: "Judge", stages: { input: ["log", "warn", "block"], output: ["log", "warn", "block"] } },
  },
  detectors: [{ id: "email", label: "Email address", group: "pii", token: "EMAIL" }, { id: "aws_key", label: "AWS access key", group: "secret", token: "AWS_KEY" }],
  strategies: ["placeholder", "mask", "hash"],
  agents: [{ id: "a1", slug: "data", name: "ClickHouse Data" }],
  features: [{ id: "chat", title: "Chat" }],
  drafting: false,
};

describe("GuardrailsPanel", () => {
  beforeEach(() => {
    useRbacStore.setState({ roles: [], permissions: [RBAC_PERMISSIONS.AI_GUARDRAILS_VIEW, RBAC_PERMISSIONS.AI_GUARDRAILS_MANAGE] });
    server.use(
      http.get("/api/ai-guardrails", () => HttpResponse.json({ success: true, data: catalog })),
      http.get("/api/ai-guardrails/events", () => HttpResponse.json({ success: true, data: { events: [{ id: "e1", createdAt: Date.now(), guardrailId: pii.id, guardrailName: "PII redaction", kind: "pattern", stage: "tool_result", action: "redact", mode: "enforce", matchCount: 3, source: "agent", userId: "u", requestId: "r1", agentPath: "chouse-assistant", tool: "run_select_query", reason: "3 matches" }] } })),
    );
  });

  it("lists guardrails with their triggers and recent events", async () => {
    render(<GuardrailsPanel />, { wrapper });
    const table = await screen.findByRole("table", { name: "Guardrails" });
    expect(within(table).getByText("PII redaction")).toBeDefined();
    expect(within(table).getByText("12")).toBeDefined();
    const triggers = await screen.findByRole("table", { name: "Guardrail triggers" });
    expect(within(triggers).getByText("3 matches")).toBeDefined();
    expect(within(triggers).getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/ai/usage?request=r1");
  });

  it("walks the new guardrail dialog, checking each step, and saves in shadow mode", async () => {
    let saved: unknown = null;
    server.use(http.post("/api/ai-guardrails", async ({ request }) => {
      saved = await request.json();
      return HttpResponse.json({ success: true, data: { ...pii, ...(saved as object), id: "g2", mode: "shadow" } }, { status: 201 });
    }));
    render(<GuardrailsPanel />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /New guardrail/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByRole("alert").textContent).toContain("Choose a kind");
    fireEvent.click(within(dialog).getByRole("button", { name: /Keyword list/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByRole("alert").textContent).toContain("Enter a name");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Project codenames" } });
    fireEvent.change(within(dialog).getByLabelText("Terms"), { target: { value: "falcon\nheron" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(within(dialog).getByRole("button", { name: "Tool results" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save in shadow mode" }));

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toEqual(expect.objectContaining({
      slug: "project-codenames", name: "Project codenames", kind: "keywords", mode: "shadow", stages: ["input"], action: "redact",
      config: { terms: ["falcon", "heron"], strategy: "placeholder" }, position: 30,
    }));
  });

  it("hides editing controls without the manage permission", async () => {
    useRbacStore.setState({ roles: [], permissions: [RBAC_PERMISSIONS.AI_GUARDRAILS_VIEW] });
    render(<GuardrailsPanel />, { wrapper });
    await screen.findByRole("table", { name: "Guardrails" });
    expect(screen.queryByRole("button", { name: /New guardrail/ })).toBeNull();
    expect((screen.getByRole("switch", { name: "Disable PII redaction" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("GuardrailsPanel recent triggers", () => {
  const secrets: Guardrail = { ...pii, id: "builtin-guardrail-secrets", slug: "secret-detection", name: "Secret detection", position: 30 };
  let stored: GuardrailEvent[] = [];
  let requests: URLSearchParams[] = [];

  function trigger(i: number): GuardrailEvent {
    const g = i % 3 === 0 ? secrets : pii;
    return {
      id: `e${i}`, createdAt: Date.now() - i * 60_000, guardrailId: g.id, guardrailName: g.name, kind: "pattern", stage: "tool_result",
      action: "redact", mode: i % 2 === 0 ? "enforce" : "shadow", matchCount: 1, source: "agent", userId: "u", requestId: null,
      agentPath: "chouse-assistant", tool: null, reason: `trigger ${i}`,
    };
  }

  function renderPanel(): QueryClient {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><GuardrailsPanel /></QueryClientProvider></MemoryRouter>);
    return client;
  }

  async function range(text: string): Promise<void> {
    await waitFor(() => expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === text)).toBeDefined());
  }

  async function choose(user: ReturnType<typeof userEvent.setup>, combobox: string, option: string): Promise<void> {
    await user.click(screen.getByRole("combobox", { name: combobox }));
    await user.click(await screen.findByRole("option", { name: option }));
  }

  const last = (): Record<string, string> => Object.fromEntries(requests[requests.length - 1]);

  beforeEach(() => {
    // jsdom lacks the pointer APIs Radix Select calls.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
    useRbacStore.setState({ roles: [], permissions: [RBAC_PERMISSIONS.AI_GUARDRAILS_VIEW] });
    stored = Array.from({ length: 60 }, (_, i) => trigger(i));
    requests = [];
    server.use(
      http.get("/api/ai-guardrails", () => HttpResponse.json({ success: true, data: { ...catalog, guardrails: [pii, secrets] } })),
      http.get("/api/ai-guardrails/events", ({ request }) => {
        const q = new URL(request.url).searchParams;
        requests.push(q);
        const matching = stored.filter((e) => (!q.get("guardrailId") || e.guardrailId === q.get("guardrailId")) && (!q.get("mode") || e.mode === q.get("mode")));
        const offset = Number(q.get("offset") ?? 0);
        return HttpResponse.json({ success: true, data: { events: matching.slice(offset, offset + Number(q.get("limit") ?? 100)), total: matching.length } });
      }),
    );
  });

  it("pages with next, previous, last and the page size, back to page one on a new size", async () => {
    const user = userEvent.setup();
    renderPanel();
    await range("1–25 of 60 triggers");
    expect(last()).toEqual({ days: "1", offset: "0", limit: "25" });
    expect(within(screen.getByRole("table", { name: "Guardrail triggers" })).getAllByRole("row")).toHaveLength(26);
    expect(screen.getByRole("button", { name: "Previous page" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await range("26–50 of 60 triggers");
    expect(last()).toEqual(expect.objectContaining({ offset: "25" }));
    expect(screen.getByText("trigger 25")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Last page" }));
    await range("51–60 of 60 triggers");
    expect(screen.getByRole("button", { name: "Next page" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await range("26–50 of 60 triggers");

    await choose(user, "Rows per page", "50");
    await range("1–50 of 60 triggers");
    expect(last()).toEqual(expect.objectContaining({ offset: "0", limit: "50" }));
  });

  it("filters by guardrail and mode, and a new filter or window starts from page one", async () => {
    const user = userEvent.setup();
    renderPanel();
    await range("1–25 of 60 triggers");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await range("26–50 of 60 triggers");

    await choose(user, "Trigger mode", "Shadow");
    await range("1–25 of 30 triggers");
    expect(last()).toEqual(expect.objectContaining({ mode: "shadow", offset: "0" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await range("26–30 of 30 triggers");

    await choose(user, "Trigger guardrail", "Secret detection");
    await range("1–10 of 10 triggers");
    expect(last()).toEqual(expect.objectContaining({ mode: "shadow", guardrailId: secrets.id, offset: "0" }));
    expect(screen.getAllByText(/redact · shadow/)).toHaveLength(10);

    await choose(user, "Trigger mode", "All modes");
    await choose(user, "Trigger guardrail", "All guardrails");
    await range("1–25 of 60 triggers");
    await user.click(screen.getByRole("button", { name: "Last page" }));
    await range("51–60 of 60 triggers");
    await choose(user, "Trigger window", "7 days");
    await range("1–25 of 60 triggers");
    expect(last()).toEqual({ days: "7", offset: "0", limit: "25" });

    stored = [];
    await choose(user, "Trigger mode", "Enforce");
    expect(await screen.findByText("No triggers match")).toBeDefined();
  });

  it("steps back to the last page when triggers age out from under it", async () => {
    const user = userEvent.setup();
    const client = renderPanel();
    await range("1–25 of 60 triggers");
    await user.click(screen.getByRole("button", { name: "Last page" }));
    await range("51–60 of 60 triggers");

    stored = stored.slice(0, 30);
    await act(() => client.invalidateQueries());
    await range("26–30 of 30 triggers");
    expect(last()).toEqual(expect.objectContaining({ offset: "25" }));
    expect(screen.queryByText("No triggers")).toBeNull();
  });
});
