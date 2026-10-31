/**
 * The agent sign-in page (ADR 0028 §4): errors that stay on CHouse, signing in
 * first, the consent card, and where Allow and Deny send the browser.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import type { OAuthSignInRequest } from "@/api/oauth";

const auth = { isAuthenticated: true, isInitialized: true, isLoading: false, logout: vi.fn(async () => undefined) };
vi.mock("@/stores", () => ({ useRbacStore: () => auth }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const getSignInRequest = vi.fn<(id: string) => Promise<OAuthSignInRequest>>();
const approveSignIn = vi.fn();
const denySignIn = vi.fn();
vi.mock("@/api/oauth", () => ({
  getSignInRequest: (id: string) => getSignInRequest(id),
  approveSignIn: (...args: unknown[]) => approveSignIn(...args),
  denySignIn: (...args: unknown[]) => denySignIn(...args),
}));

import OAuthConnect from "./OAuthConnect";

const REQUEST: OAuthSignInRequest = {
  request: { id: "r1", expiresAt: Date.now() + 600_000 },
  client: { id: "chc_1", name: "Atlas Agent", status: "allowed", returnsTo: "agent.example", clientUri: null },
  user: { email: "rina@acme.com", username: "rina" },
  canAct: true,
  ceiling: { toolkits: ["data", "scheduling"], maxTier: "t2" },
  defaults: { toolkits: ["data"], t1: "auto", t2: "confirm", t3: "approver" },
  dayChoices: [1, 7, 30, 90],
  defaultDays: 90,
};

let location: { pathname: string; search: string } | null = null;
const assign = vi.fn();
const originalLocation = window.location;

function Capture(): null {
  location = useLocation();
  return null;
}

function renderAt(url: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/preferences/connect" element={<OAuthConnect />} />
          <Route path="*" element={<Capture />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.isAuthenticated = true;
  location = null;
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, assign } });
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("OAuthConnect", () => {
  it("explains problems the agent can't be told about", () => {
    renderAt("/preferences/connect?error=client_pending");
    expect(screen.getByRole("alert").textContent).toContain("This agent isn't approved yet");
    expect(getSignInRequest).not.toHaveBeenCalled();
  });

  it("falls back to a general message for an unknown error or no request", () => {
    renderAt("/preferences/connect");
    expect(screen.getByRole("alert").textContent).toContain("This sign-in can't continue");
  });

  it("sends a signed-out person to sign in and back here", async () => {
    auth.isAuthenticated = false;
    renderAt("/preferences/connect?request=r1");
    await waitFor(() => expect(location?.pathname).toBe("/login"));
    expect(new URLSearchParams(location?.search).get("redirect")).toBe("/preferences/connect?request=r1");
  });

  it("shows who is asking, where it returns, and as whom", async () => {
    getSignInRequest.mockResolvedValue(REQUEST);
    renderAt("/preferences/connect?request=r1");
    expect(await screen.findByRole("heading", { name: "Atlas Agent wants to use CHouse as you" })).toBeTruthy();
    expect(screen.getByText("Unverified name")).toBeTruthy();
    expect(screen.getByText("Returns to agent.example")).toBeTruthy();
    expect(screen.getByText("rina@acme.com")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Data & Query" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("switch", { name: "Access" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers reads only when the role can't let agents change things", async () => {
    getSignInRequest.mockResolvedValue({ ...REQUEST, canAct: false, defaults: { ...REQUEST.defaults, toolkits: [] } });
    renderAt("/preferences/connect?request=r1");
    expect(await screen.findByText("Your role doesn't let agents change anything, so this agent will only read.")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Data & Query" })).toBeNull();
  });

  it("approves with the chosen policy and returns to the agent", async () => {
    getSignInRequest.mockResolvedValue(REQUEST);
    approveSignIn.mockResolvedValue({ redirectUrl: "https://agent.example/cb?code=c&state=s" });
    renderAt("/preferences/connect?request=r1");
    fireEvent.click(await screen.findByRole("switch", { name: "Scheduling" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(await screen.findByRole("heading", { name: "Atlas Agent is connected." })).toBeTruthy();
    expect(approveSignIn).toHaveBeenCalledWith("r1", { toolkits: ["data", "scheduling"], t1: "auto", t2: "confirm", t3: "approver" }, 90);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://agent.example/cb?code=c&state=s"), { timeout: 2000 });
  });

  it("denies straight back to the agent", async () => {
    getSignInRequest.mockResolvedValue(REQUEST);
    denySignIn.mockResolvedValue({ redirectUrl: "https://agent.example/cb?error=access_denied" });
    renderAt("/preferences/connect?request=r1");
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://agent.example/cb?error=access_denied"));
    expect(approveSignIn).not.toHaveBeenCalled();
  });

  it("shows why it can't continue when the request expired", async () => {
    getSignInRequest.mockRejectedValue(new Error("This sign-in request has expired or was already answered. Start again from your agent."));
    renderAt("/preferences/connect?request=gone");
    expect((await screen.findByRole("alert")).textContent).toContain("expired or was already answered");
  });

  it("keeps the card and shows the error when answering fails", async () => {
    getSignInRequest.mockResolvedValue(REQUEST);
    approveSignIn.mockRejectedValue(new Error("This sign-in request was already answered."));
    renderAt("/preferences/connect?request=r1");
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(await screen.findByText("This sign-in request was already answered.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});
