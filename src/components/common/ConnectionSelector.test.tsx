import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BindingState, OwnBinding } from "@/api/clickhouseBindings";
import type { CallerIdentity } from "@/api/connectionIdentity";
import { useRbacStore } from "@/stores";
import { server } from "@/test/mocks/server";
import { SharedLogin } from "./ConnectionSelector";

afterEach(cleanup);

function link(state: BindingState, patch: Partial<OwnBinding> = {}): OwnBinding {
  return {
    id: "b-1",
    connectionId: "conn-1",
    connectionName: "Production",
    connectionKind: "personal",
    clickhouseUser: "Alice_CH",
    defaultDatabase: null,
    state,
    reason: null,
    checkedAt: null,
    ...patch,
  };
}

function serveLinks(links: OwnBinding[]): void {
  server.use(http.get("/api/rbac/clickhouse-bindings/mine", () => HttpResponse.json({ success: true, data: { bindings: links } })));
}

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("SharedLogin", () => {
  it("names the shared ClickHouse user everyone's statements run as", () => {
    const { container } = render(<SharedLogin username="chouse" identityMode="shared" />);
    expect(container.textContent).toBe("Shared login chouse");
    expect(container.querySelector("span")?.getAttribute("title")).toBe(
      "Everyone using this connection in CHouse sends statements as this ClickHouse user.",
    );
  });

  it("reads a connection without a kind as a shared login", () => {
    const { container } = render(<SharedLogin username="chouse" />);
    expect(container.textContent).toBe("Shared login chouse");
  });

  it("says a role ceiling limits the person to their ClickHouse role", () => {
    const { container } = render(<SharedLogin username="chouse_login" identityMode="shared_ceiling" />);
    expect(container.textContent).toBe("Shared login chouse_login, limited to your ClickHouse role");
    expect(container.querySelector("span")?.getAttribute("title")).toBe(
      "Your statements on this connection run as this ClickHouse user, with only the ClickHouse role mapped to your CHouse role.",
    );
  });

  it("keeps the user name's case, since ClickHouse user names are case-sensitive", () => {
    const { container } = render(<SharedLogin username="ChouseLogin" identityMode="shared_ceiling" />);
    expect(container.querySelector("span span")?.className).toContain("normal-case");
    expect(container.querySelector("span span")?.textContent).toBe("ChouseLogin");
  });
});

describe("SharedLogin on a personal connection", () => {
  beforeEach(() => {
    useRbacStore.setState({ isAuthenticated: true });
  });

  function renderPersonal(connectionId = "conn-1"): HTMLElement {
    return render(<SharedLogin username="chouse_login" identityMode="personal" connectionId={connectionId} />, { wrapper }).container;
  }

  it("names the person's own ClickHouse user when their link is active, keeping its case", async () => {
    serveLinks([link("active")]);
    const container = renderPersonal();

    await waitFor(() => expect(container.textContent).toBe("As Alice_CH (your ClickHouse user)"));
    expect(container.querySelector("span span")?.className).toContain("normal-case");
    expect(container.textContent).not.toContain("chouse_login");
  });

  it.each([
    ["pending_grant", "Your ClickHouse link is waiting"],
    ["suspended", "Your ClickHouse link is suspended"],
    ["disabled", "Your ClickHouse link is disabled"],
  ] as const)("says a %s link cannot be used", async (state, text) => {
    serveLinks([link(state, { reason: "Ask a super admin." })]);
    const container = renderPersonal();

    await waitFor(() => expect(container.textContent).toBe(text));
    expect(container.querySelector("span")?.getAttribute("title")).toBe("Ask a super admin.");
  });

  it("says so when the person has no link on this connection", async () => {
    serveLinks([link("active", { connectionId: "conn-2" })]);
    const container = renderPersonal();

    await waitFor(() => expect(container.textContent).toBe("No ClickHouse user linked"));
  });

  it("claims neither a link nor its absence before the links are read", () => {
    serveLinks([]);
    const container = renderPersonal();

    expect(container.textContent).toBe("Your own ClickHouse user");
  });

  it("never shows the connection's login as the person's user when the read fails", async () => {
    server.use(
      http.get("/api/rbac/clickhouse-bindings/mine", () =>
        HttpResponse.json({ success: false, error: { code: "INTERNAL", message: "boom" } }, { status: 500 }),
      ),
    );
    const container = renderPersonal();

    await waitFor(() => expect(container.querySelector("span")?.getAttribute("title")).toContain("your own ClickHouse user"));
    expect(container.textContent).toBe("Your own ClickHouse user");
  });
});

describe("SharedLogin on a role-ceiling connection", () => {
  beforeEach(() => {
    useRbacStore.setState({ isAuthenticated: true });
  });

  function serveIdentities(identities: CallerIdentity[]): void {
    server.use(http.get("/api/rbac/connections/identity/mine", () => HttpResponse.json({ success: true, data: { identities } })));
  }

  function ceiling(state: CallerIdentity["state"], patch: Partial<CallerIdentity> = {}): CallerIdentity {
    return { connectionId: "conn-1", connectionName: "Production", kind: "shared_ceiling", runsAs: null, state, detail: "Refused.", limits: [], ...patch };
  }

  function renderCeiling(accessContact: string | null = "#finance-data"): HTMLElement {
    return render(<SharedLogin username="chouse_login" identityMode="shared_ceiling" connectionId="conn-1" accessContact={accessContact} />, { wrapper }).container;
  }

  it("names the ClickHouse role the person is limited to", async () => {
    serveIdentities([ceiling("ready", { runsAs: { type: "role", name: "Analyst_RO" }, detail: null })]);
    const container = renderCeiling();

    await waitFor(() => expect(container.textContent).toBe("Limited to Analyst_RO"));
  });

  it("says the person's role is not mapped, and whom to ask", async () => {
    serveIdentities([ceiling("no_usable_role")]);
    const container = renderCeiling();

    await waitFor(() => expect(container.textContent).toBe("Your role isn't mapped here yet — ask #finance-data"));
    expect(container.querySelector("span")?.className).toContain("text-amber");
  });

  it("asks a super admin when the connection names no contact", async () => {
    serveIdentities([ceiling("no_usable_role")]);
    const container = renderCeiling(null);

    await waitFor(() => expect(container.textContent).toBe("Your role isn't mapped here yet — ask a super admin"));
  });

  it("says the connection is unavailable while its login fails the checks", async () => {
    serveIdentities([ceiling("connection_unavailable")]);
    const container = renderCeiling();

    await waitFor(() => expect(container.textContent).toBe("Unavailable: the login is failing its checks"));
  });

  it("keeps the general line until the answer is in, and when it has nothing for the connection", async () => {
    serveIdentities([ceiling("no_usable_role", { connectionId: "conn-2" })]);
    const container = renderCeiling();

    expect(container.textContent).toBe("Shared login chouse_login, limited to your ClickHouse role");
    await waitFor(() => expect(container.textContent).toBe("Shared login chouse_login, limited to your ClickHouse role"));
  });
});
