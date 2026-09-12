#!/usr/bin/env python3
"""DinD E2E checker for ADR 0013 (CHouse MCP server).

Runs INSIDE the compose network (via `docker run --network <project>_default`)
where `chouse-ui:5521` and `chouse-ui:8752/mcp` resolve. Proves the agent
surface: PAT-only auth, read-only toolset, SQL classification, and that
revoking the PAT fails the very next call (no TTL lag).

Exit 0 = all checks green. Any failure prints CHECK <name>: FAIL and exits 1.
"""

import json
import base64
import sys
import time
import urllib.request
import urllib.error

BASE = "http://chouse-ui:5521"
MCP = "http://chouse-ui:8752/mcp"
CLICKHOUSE = "http://clickhouse:8123"
FAILURES: list[str] = []


def check(name: str, fn) -> None:
    try:
        fn()
    except Exception as error:  # noqa: BLE001 - report, don't crash
        FAILURES.append(name)
        print(f"CHECK {name}: FAIL ({error})", flush=True)
    else:
        print(f"CHECK {name}: ok", flush=True)


def api(
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict | None = None,
    xhr: bool = False,
) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if xhr:
        headers["X-Requested-With"] = "XMLHttpRequest"
    request = urllib.request.Request(
        BASE + path, data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode() or "{}"
            return response.status, json.loads(payload)
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode() or "{}")
        except json.JSONDecodeError:
            return error.code, {}


def rpc(
    method: str,
    params: dict,
    *,
    token: str | None = None,
    origin: str | None = None,
    expect_http_error: bool = False,
) -> tuple[int, dict]:
    """One stateless JSON-RPC POST to the MCP endpoint.

    Returns (http_status, parsed_jsonrpc_message). SSE responses are parsed
    by taking the first non-empty `data:` line.
    """
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if origin:
        headers["Origin"] = origin
    request = urllib.request.Request(
        MCP, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
        headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status, raw = response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read().decode()
        if not expect_http_error and status >= 400:
            return status, {}
    if expect_http_error:
        return status, {"raw": raw}
    for line in raw.split("\n"):
        if line.startswith("data:") and line[5:].strip():
            return status, json.loads(line[5:].strip())
    return status, json.loads(raw or "{}")


def wait_for_health() -> None:
    last = "unreachable"
    for _ in range(90):
        try:
            status, _ = api("GET", "/api/health")
            if status == 200:
                break
            last = f"status {status}"
        except Exception as error:  # noqa: BLE001
            last = str(error)
        time.sleep(2)
    else:
        raise RuntimeError(f"server never became healthy ({last})")

    # ClickHouse boots slower than the UI; wait for it before provisioning.
    clickhouse = urllib.request.Request(
        f"{CLICKHOUSE}/?query=SELECT%201",
        headers={"Authorization": "Basic " + base64.b64encode(b"admin:password").decode()},
        method="GET",
    )
    for _ in range(60):
        try:
            with urllib.request.urlopen(clickhouse, timeout=10) as response:
                if response.status == 200:
                    return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
    raise RuntimeError("clickhouse never became ready")


STATE: dict[str, str] = {}


def login_and_provision() -> None:
    status, payload = api(
        "POST", "/api/rbac/auth/login",
        body={"identifier": "admin@localhost", "password": "admin123!"},
        xhr=True,
    )
    assert status == 200, f"login status {status}: {payload}"
    STATE["admin_jwt"] = payload["data"]["tokens"]["accessToken"]

    status, payload = api(
        "POST", "/api/rbac/connections",
        token=STATE["admin_jwt"],
        body={
            "name": "e2e-mcp-clickhouse",
            # Trailing dot = absolute DNS name (see e2e-pat-check.py note).
            "host": "clickhouse.",
            "port": 8123,
            "username": "admin",
            "password": "password",
        },
        xhr=True,
    )
    assert status == 201, f"create connection status {status}: {payload}"
    STATE["connection_id"] = payload["data"]["id"]
    status, payload = api(
        "PATCH",
        f"/api/rbac/connections/{STATE['connection_id']}",
        token=STATE["admin_jwt"],
        body={"isDefault": True},
        xhr=True,
    )
    assert status == 200, f"set default status {status}: {payload}"

    status, payload = api(
        "POST", "/api/rbac/pats",
        token=STATE["admin_jwt"],
        body={"name": "e2e-mcp"},
        xhr=True,
    )
    assert status == 201, f"create PAT status {status}: {payload}"
    STATE["pat"] = payload["data"]["rawToken"]
    STATE["pat_id"] = payload["data"]["token"]["id"]


def mcp_initialize() -> None:
    status, message = rpc("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "e2e", "version": "0.0.0"},
    }, token=STATE["pat"])
    assert status == 200, f"initialize http status {status}"
    name = message.get("result", {}).get("serverInfo", {}).get("name")
    assert name == "chouse", f"unexpected serverInfo: {name}"


def mcp_toolset_is_read_only() -> None:
    status, message = rpc("tools/list", {}, token=STATE["pat"])
    assert status == 200, f"tools/list http status {status}"
    names = [tool["name"] for tool in message.get("result", {}).get("tools", [])]
    for expected in ["whoami", "query", "describe_table", "metrics_overview", "audit_list"]:
        assert expected in names, f"missing default tool {expected}: {names}"
    for gated in ["run_scheduled_job", "acknowledge_incident", "kill_query", "query_raw", "delete_saved_query", "ai_optimize"]:
        assert gated not in names, f"write/destructive/ai tool leaked into the default set: {names}"


def find_rows(obj):
    """Recursively locate the first list-of-dicts (ClickHouse result rows)."""
    if isinstance(obj, list):
        if obj and isinstance(obj[0], dict):
            return obj
        return None
    if isinstance(obj, dict):
        for key in ("data", "rows", "result"):
            if key in obj:
                found = find_rows(obj[key])
                if found is not None:
                    return found
    return None


def mcp_query_select_works() -> None:
    status, message = rpc("tools/call", {"name": "query", "arguments": {"sql": "SELECT 1 AS one"}}, token=STATE["pat"])
    assert status == 200, f"tools/call http status {status}"
    result = message.get("result", {})
    assert not result.get("isError"), f"query tool errored: {result}"
    text = result["content"][0]["text"]
    parsed = json.loads(text)
    rows = find_rows(parsed)
    assert rows, f"no row data in query result: {text[:400]}"
    assert rows[0].get("one") == 1, f"unexpected rows: {rows}"


def mcp_query_refuses_writes() -> None:
    status, message = rpc("tools/call", {"name": "query", "arguments": {"sql": "DROP TABLE system.tables"}}, token=STATE["pat"])
    assert status == 200, f"tools/call http status {status}"
    result = message.get("result", {})
    assert result.get("isError"), f"write SQL was not refused: {result}"
    assert "Refused" in result["content"][0]["text"], result["content"][0]["text"]


def mcp_write_tool_absent() -> None:
    status, message = rpc("tools/call", {"name": "run_scheduled_job", "arguments": {"id": "x"}}, token=STATE["pat"])
    # Write tools are not registered: the request must not mutate anything —
    # the SDK answers with an error instead of a successful tool result.
    assert status == 200, f"http status {status}"
    assert message.get("result", {}).get("isError") or "error" in message, f"unexpected success: {message}"


def mcp_rejects_origin() -> None:
    status, _ = rpc("tools/list", {}, token=STATE["pat"], origin="https://evil.example", expect_http_error=True)
    assert status == 403, f"expected 403 for foreign Origin, got {status}"


def mcp_rejects_jwt() -> None:
    status, _ = rpc("tools/list", {}, token="eyJhbGciOiJIUzI1NiJ9.e30.sig", expect_http_error=True)
    assert status == 401, f"expected 401 for a browser JWT, got {status}"


def revoked_pat_fails_next_call() -> None:
    status, payload = api("POST", f"/api/rbac/pats/{STATE['pat_id']}/rotate", token=STATE["admin_jwt"], xhr=True)
    assert status == 201, f"rotate status {status}: {payload}"
    status, _ = rpc("tools/list", {}, token=STATE["pat"], expect_http_error=True)
    assert status == 401, f"expected 401 for the rotated-away PAT, got {status}"


def main() -> int:
    check("health", wait_for_health)
    check("login_and_provision", login_and_provision)
    check("mcp_initialize", mcp_initialize)
    check("mcp_toolset_is_read_only", mcp_toolset_is_read_only)
    check("mcp_query_select_works", mcp_query_select_works)
    check("mcp_query_refuses_writes", mcp_query_refuses_writes)
    check("mcp_write_tool_absent", mcp_write_tool_absent)
    check("mcp_rejects_origin", mcp_rejects_origin)
    check("mcp_rejects_jwt", mcp_rejects_jwt)
    check("revoked_pat_fails_next_call", revoked_pat_fails_next_call)

    if FAILURES:
        print(f"\n{len(FAILURES)} MCP E2E check(s) failed: {', '.join(FAILURES)}", file=sys.stderr)
        return 1
    print("\nAll MCP E2E checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
