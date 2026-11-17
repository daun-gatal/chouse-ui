import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { CallerIdentity } from "@/api/connectionIdentity";
import { server } from "@/test/mocks/server";
import { useRbacStore } from "@/stores";
import { identityOnConnection, myConnectionIdentitiesKey, useMyConnectionIdentities } from "./useMyConnectionIdentities";

const CEILING: CallerIdentity = {
  connectionId: "conn-1",
  connectionName: "Production",
  kind: "shared_ceiling",
  runsAs: null,
  state: "no_usable_role",
  detail: "Your CHouse role is not mapped on this connection. Ask #data-platform.",
  limits: [],
};

function wrapper(): ({ children }: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useMyConnectionIdentities", () => {
  beforeEach(() => {
    useRbacStore.setState({ isAuthenticated: true });
  });

  it("loads the signed-in person's identity on each connection", async () => {
    server.use(http.get("/api/rbac/connections/identity/mine", () => HttpResponse.json({ success: true, data: { identities: [CEILING] } })));
    const { result } = renderHook(() => useMyConnectionIdentities(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([CEILING]);
  });

  it("asks nothing while signed out", () => {
    useRbacStore.setState({ isAuthenticated: false });
    let calls = 0;
    server.use(http.get("/api/rbac/connections/identity/mine", () => {
      calls += 1;
      return HttpResponse.json({ success: true, data: { identities: [] } });
    }));
    const { result } = renderHook(() => useMyConnectionIdentities(), { wrapper: wrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(calls).toBe(0);
  });

  it("keys the answer by account", () => {
    expect(myConnectionIdentitiesKey("u-1")).toEqual(["my-connection-identities", "u-1"]);
    expect(myConnectionIdentitiesKey(undefined)).toEqual(["my-connection-identities", null]);
  });

  it("finds the identity on one connection, and nothing for another", () => {
    expect(identityOnConnection([CEILING], "conn-1")).toEqual(CEILING);
    expect(identityOnConnection([CEILING], "conn-2")).toBeNull();
    expect(identityOnConnection(undefined, "conn-1")).toBeNull();
  });
});
