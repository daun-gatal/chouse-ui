import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { OwnBinding } from "@/api/clickhouseBindings";
import { server } from "@/test/mocks/server";
import { useRbacStore } from "@/stores";
import { linkOnConnection, myClickHouseLinksKey, useMyClickHouseLinks } from "./useMyClickHouseLinks";

const LINK: OwnBinding = {
  id: "b-1",
  connectionId: "conn-1",
  connectionName: "Production",
  connectionKind: "personal",
  clickhouseUser: "alice_ch",
  defaultDatabase: "analytics",
  state: "active",
  reason: null,
  checkedAt: 1_800_000_000_000,
};

function createWrapper(client: QueryClient): ({ children }: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function serveLinks(links: OwnBinding[]): { calls: () => number } {
  let calls = 0;
  server.use(
    http.get("/api/rbac/clickhouse-bindings/mine", () => {
      calls += 1;
      return HttpResponse.json({ success: true, data: { bindings: links } });
    }),
  );
  return { calls: () => calls };
}

describe("useMyClickHouseLinks", () => {
  beforeEach(() => {
    useRbacStore.setState({ isAuthenticated: true });
  });

  it("loads the signed-in person's links", async () => {
    serveLinks([LINK]);
    const { result } = renderHook(() => useMyClickHouseLinks(), { wrapper: createWrapper(newClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([LINK]);
  });

  it("sends one request for two readers", async () => {
    const served = serveLinks([LINK]);
    const wrapper = createWrapper(newClient());
    const first = renderHook(() => useMyClickHouseLinks(), { wrapper });
    const second = renderHook(() => useMyClickHouseLinks(), { wrapper });

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(served.calls()).toBe(1);
  });

  it("sends nothing while nobody is signed in", async () => {
    useRbacStore.setState({ isAuthenticated: false });
    const served = serveLinks([LINK]);
    const { result } = renderHook(() => useMyClickHouseLinks(), { wrapper: createWrapper(newClient()) });

    expect(result.current.fetchStatus).toBe("idle");
    expect(served.calls()).toBe(0);
  });

  it("reports a failed read as an error", async () => {
    server.use(
      http.get("/api/rbac/clickhouse-bindings/mine", () =>
        HttpResponse.json({ success: false, error: { code: "INTERNAL", message: "boom" } }, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useMyClickHouseLinks(), { wrapper: createWrapper(newClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("keys the cache by account", () => {
    expect(myClickHouseLinksKey("u-1")).toEqual(["my-clickhouse-links", "u-1"]);
    expect(myClickHouseLinksKey(undefined)).toEqual(["my-clickhouse-links", null]);
  });

  it("finds the link on a connection", () => {
    expect(linkOnConnection([LINK], "conn-1")).toEqual(LINK);
    expect(linkOnConnection([LINK], "conn-2")).toBeNull();
    expect(linkOnConnection(undefined, "conn-1")).toBeNull();
  });
});
