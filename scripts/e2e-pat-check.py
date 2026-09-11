#!/usr/bin/env python3
"""DinD E2E checker for ADR 0011 personal access tokens.

Runs INSIDE the compose network (via `docker run --network <project>_default`)
where `chouse-ui:5521` resolves. Every HTTP call is a plain machine call:
PAT requests deliberately omit X-Requested-With to prove the exemption.

Exit 0 = all checks green. Any failure prints CHECK <name>: FAIL and exits 1.
"""

import json
import base64
import sys
import time
import urllib.request
import urllib.error

BASE = "http://chouse-ui:5521"
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
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if extra_headers:
        headers.update(extra_headers)
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


def login_admin() -> None:
    status, payload = api(
        "POST",
        "/api/rbac/auth/login",
        body={"identifier": "admin@localhost", "password": "admin123!"},
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert status == 200, f"login status {status}: {payload}"
    STATE["admin_jwt"] = payload["data"]["tokens"]["accessToken"]


def provision_connection() -> None:
    jwt = STATE["admin_jwt"]
    xhr = {"X-Requested-With": "XMLHttpRequest"}
    status, payload = api(
        "POST",
        "/api/rbac/connections",
        token=jwt,
        body={
            "name": "e2e-clickhouse",
            # Trailing dot = absolute DNS name. The DinD host inherits
            # ndots:5 + k8s search domains, under which the bare "clickhouse"
            # name resolves via cluster DNS (NXDOMAIN) instead of the compose
            # network. On a normal compose host the bare name works; the dot
            # is a no-op there. This is E2E-environment-specific, not product.
            "host": "clickhouse.",
            "port": 8123,
            "username": "admin",
            "password": "password",
        },
        extra_headers=xhr,
    )
    assert status == 201, f"create connection status {status}: {payload}"
    connection_id = payload["data"]["id"]
    STATE["connection_id"] = connection_id
    status, payload = api(
        "PATCH",
        f"/api/rbac/connections/{connection_id}",
        token=jwt,
        body={"isDefault": True},
        extra_headers=xhr,
    )
    assert status == 200, f"set default status {status}: {payload}"


def create_pat() -> None:
    status, payload = api(
        "POST",
        "/api/rbac/pats",
        token=STATE["admin_jwt"],
        body={"name": "e2e-machine"},
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert status == 201, f"create PAT status {status}: {payload}"
    raw = payload["data"]["rawToken"]
    assert raw.startswith("ch_pat_"), f"unexpected prefix: {raw[:10]}"
    STATE["pat"] = raw
    STATE["pat_id"] = payload["data"]["token"]["id"]


def pat_validates_without_xhr() -> None:
    # RBAC plane + XHR exemption in one call: no X-Requested-With header.
    status, payload = api("GET", "/api/rbac/auth/validate", token=STATE["pat"])
    assert status == 200, f"validate status {status}: {payload}"
    assert payload["data"]["valid"] is True


def pat_queries_with_default_connection() -> None:
    # Data plane via default-connection fallback (no headers but Bearer).
    status, payload = api(
        "POST", "/api/query/execute", token=STATE["pat"], body={"query": "SELECT 1 AS x"}
    )
    assert status == 200, f"query status {status}: {payload}"


def pat_queries_with_explicit_connection() -> None:
    status, payload = api(
        "POST",
        "/api/query/execute",
        token=STATE["pat"],
        body={"query": "SELECT 1 AS x"},
        extra_headers={"X-Connection-Id": STATE["connection_id"]},
    )
    assert status == 200, f"explicit-connection query status {status}: {payload}"


def pat_cannot_manage_tokens() -> None:
    status, payload = api(
        "POST",
        "/api/rbac/pats",
        token=STATE["pat"],
        body={"name": "self-propagated"},
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert status == 403, f"expected 403, got {status}: {payload}"


def rotate_replaces_secret() -> None:
    old_pat = STATE["pat"]
    status, payload = api(
        "POST",
        f"/api/rbac/pats/{STATE['pat_id']}/rotate",
        token=STATE["admin_jwt"],
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert status == 201, f"rotate status {status}: {payload}"
    new_pat = payload["data"]["rawToken"]
    assert new_pat.startswith("ch_pat_"), f"unexpected prefix: {new_pat[:10]}"
    assert new_pat != old_pat
    assert payload["data"]["token"]["name"] == "e2e-machine"

    status, _ = api("GET", "/api/rbac/auth/validate", token=old_pat)
    assert status == 401, f"expected old secret to 401, got {status}"
    status, payload = api("GET", "/api/rbac/auth/validate", token=new_pat)
    assert status == 200, f"replacement should validate, got {status}: {payload}"

    STATE["pat"] = new_pat
    # Re-resolve the replacement id from the list (validate does not return it).
    # This also proves the revoked predecessor is hidden from the list.
    status, payload = api(
        "GET",
        "/api/rbac/pats",
        token=STATE["admin_jwt"],
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert status == 200, f"list status {status}: {payload}"
    ids = [t["id"] for t in payload["data"]["tokens"]]
    assert len(ids) == 1, f"expected only the replacement listed, got {ids}"
    STATE["pat_id"] = ids[0]


def scoped_pat_is_narrower() -> None:
    jwt = STATE["admin_jwt"]
    xhr = {"X-Requested-With": "XMLHttpRequest"}
    # Provision a viewer user: full PAT can SELECT, narrow PAT cannot.
    status, payload = api("GET", "/api/rbac/roles", token=jwt, extra_headers=xhr)
    assert status == 200, f"list roles status {status}: {payload}"
    viewer = next(r for r in payload["data"]["roles"] if r["name"] == "viewer")
    status, payload = api(
        "POST",
        "/api/rbac/users",
        token=jwt,
        body={
            "email": "e2e-viewer@test.local",
            "username": "e2e-viewer",
            "password": "Viewer123!",
            "roleIds": [viewer["id"]],
        },
        extra_headers=xhr,
    )
    assert status == 201, f"create user status {status}: {payload}"
    status, payload = api(
        "POST",
        "/api/rbac/auth/login",
        body={"identifier": "e2e-viewer", "password": "Viewer123!"},
        extra_headers=xhr,
    )
    assert status == 200, f"viewer login status {status}: {payload}"
    viewer_jwt = payload["data"]["tokens"]["accessToken"]

    status, payload = api(
        "POST", "/api/rbac/pats", token=viewer_jwt, body={"name": "viewer-full"}, extra_headers=xhr
    )
    assert status == 201, f"viewer PAT status {status}: {payload}"
    full_pat = payload["data"]["rawToken"]

    # Grant the viewer role reachability to the connection via a scoped policy
    # (per-user grants were removed; connection access flows from allow rules).
    status, payload = api(
        "GET",
        f"/api/rbac/data-access-policies/role/{viewer['id']}",
        token=jwt,
        extra_headers=xhr,
    )
    assert status == 200, f"role policies status {status}: {payload}"
    existing_policy_ids = [p["id"] for p in payload["data"]]
    status, payload = api(
        "POST",
        "/api/rbac/data-access-policies",
        token=jwt,
        body={
            "name": "e2e-viewer-access",
            "rules": [
                {
                    "connectionId": STATE["connection_id"],
                    "databasePattern": "*",
                    "tablePattern": "*",
                    "isAllowed": True,
                }
            ],
        },
        extra_headers=xhr,
    )
    assert status == 201, f"create policy status {status}: {payload}"
    status, payload = api(
        "POST",
        f"/api/rbac/data-access-policies/role/{viewer['id']}",
        token=jwt,
        body={"policyIds": [*existing_policy_ids, payload["data"]["id"]]},
        extra_headers=xhr,
    )
    assert status == 200, f"attach policy status {status}: {payload}"

    status, payload = api(
        "POST",
        "/api/rbac/pats",
        token=viewer_jwt,
        body={"name": "viewer-narrow", "scopes": ["metrics:view"]},
        extra_headers=xhr,
    )
    assert status == 201, f"scoped PAT status {status}: {payload}"
    narrow_pat = payload["data"]["rawToken"]

    status, _ = api("POST", "/api/query/execute", token=full_pat, body={"query": "SELECT 1 AS x"})
    assert status == 200, f"full PAT query status {status}"
    status, payload = api(
        "POST", "/api/query/execute", token=narrow_pat, body={"query": "SELECT 1 AS x"}
    )
    assert status == 403, f"expected scoped PAT to be denied, got {status}: {payload}"


def revoke_kills_pat_but_not_jwt() -> None:
    status, payload = api(
        "DELETE",
        f"/api/rbac/pats/{STATE['pat_id']}",
        token=STATE["admin_jwt"],
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert status == 200, f"revoke status {status}: {payload}"
    status, _ = api("GET", "/api/rbac/auth/validate", token=STATE["pat"])
    assert status == 401, f"expected revoked PAT to 401, got {status}"
    status, _ = api(
        "GET",
        "/api/rbac/auth/validate",
        token=STATE["admin_jwt"],
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert status == 200, f"JWT should survive PAT revocation, got {status}"


def pat_actions_audited() -> None:
    jwt = STATE["admin_jwt"]
    xhr = {"X-Requested-With": "XMLHttpRequest"}
    for action in ("pat.create", "pat.rotate", "pat.revoke"):
        status, payload = api(
            "GET", f"/api/rbac/audit?action={action}&limit=50", token=jwt, extra_headers=xhr
        )
        assert status == 200, f"audit list status {status}: {payload}"
        logs = payload["data"]["logs"]
        assert any(entry["action"] == action for entry in logs), (
            f"no {action} entry in audit log"
        )
    status, payload = api("GET", "/api/rbac/audit/actions", token=jwt, extra_headers=xhr)
    assert status == 200, f"audit actions status {status}: {payload}"
    assert set(("pat.create", "pat.rotate", "pat.revoke")) <= set(
        payload["data"]["groupedActions"].get("pat", [])
    ), f"pat group missing: {payload['data']['groupedActions'].get('pat')}"


def main() -> int:
    check("health", wait_for_health)
    if FAILURES:
        return 1
    check("login_admin", login_admin)
    check("provision_connection", provision_connection)
    check("create_pat", create_pat)
    check("pat_validates_without_xhr", pat_validates_without_xhr)
    check("pat_queries_with_default_connection", pat_queries_with_default_connection)
    check("pat_queries_with_explicit_connection", pat_queries_with_explicit_connection)
    check("pat_cannot_manage_tokens", pat_cannot_manage_tokens)
    check("rotate_replaces_secret", rotate_replaces_secret)
    check("scoped_pat_is_narrower", scoped_pat_is_narrower)
    check("revoke_kills_pat_but_not_jwt", revoke_kills_pat_but_not_jwt)
    check("pat_actions_audited", pat_actions_audited)
    if FAILURES:
        print(f"E2E PAT: {len(FAILURES)} check(s) failed: {FAILURES}")
        return 1
    print("E2E PAT: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
