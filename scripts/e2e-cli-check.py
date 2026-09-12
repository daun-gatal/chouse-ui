#!/usr/bin/env python3
"""In-network E2E for the chouse CLI (ADR 0012).

Runs INSIDE the compose network where `chouse-ui:5521` and `clickhouse:8123`
resolve. Phase 1 provisions via plain HTTP (login -> connection -> PAT);
phase 2 exercises the real /usr/local/bin/chouse binary as a user/agent
would, asserting outputs and exit codes.

Exit 0 = all green. Any failure prints CHECK <name>: FAIL and exits 1.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "http://chouse-ui:5521"
CLICKHOUSE = "http://clickhouse:8123"
CHOUSE = "/usr/local/bin/chouse"
FAILURES: list[str] = []
STATE: dict[str, str] = {}
TAG = str(int(time.time()))[-5:]  # unique per run: no cross-run collisions
DB = f"e2e_cli_{TAG}"
CONN_NAME = f"e2e-cli-ch-{TAG}"


def check(name, fn):
    try:
        fn()
    except Exception as error:  # noqa: BLE001 - report, don't crash
        FAILURES.append(name)
        print(f"CHECK {name}: FAIL ({error})", flush=True)
    else:
        print(f"CHECK {name}: ok", flush=True)


def api(method, path, *, token=None, body=None, extra_headers=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode() or "{}")
        except json.JSONDecodeError:
            return error.code, {}


def cli(*args, pat=True, env_extra=None, stdin_text=None):
    env = dict(os.environ)
    env["CHOUSE_SERVER"] = BASE
    if "connection_id" in STATE:
        env.setdefault("CHOUSE_CONNECTION", STATE["connection_id"])
    if pat:
        env["CH_HOUSE_PAT"] = STATE["pat"]
    else:
        env.pop("CH_HOUSE_PAT", None)
    if env_extra:
        env.update(env_extra)
    proc = subprocess.run(
        [CHOUSE, *args], capture_output=True, text=True,
        input=stdin_text, timeout=120, env=env,
    )
    return proc


def cli_scrubbed(*args, home=None, stdin_text=None):
    """Run with no server/PAT/config: fresh (or given) HOME, empty server
    (empty string resolves as unset), no token. Proves nothing talks to a
    phantom default. Pass home= to share state across calls (e.g. login
    persistence); otherwise each call gets an isolated HOME.
    """
    import tempfile as _tf  # noqa: E402
    if home is None:
        home = _tf.mkdtemp(prefix="chouse-e2e-nohome-")
    env = dict(os.environ)
    env["HOME"] = home
    env["CHOUSE_SERVER"] = ""
    env["CHOUSE_PROFILE"] = ""
    env.pop("CH_HOUSE_PAT", None)
    proc = subprocess.run(
        [CHOUSE, *args], capture_output=True, text=True,
        input=stdin_text, timeout=60, env=env,
    )
    return proc


def need(proc, what="command"):
    assert proc.returncode == 0, f"{what} exit={proc.returncode}: {proc.stderr[-500:]}"
    return proc.stdout


# ---------- phase 1: provision ----------

def wait_for_stack():
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
        raise RuntimeError(f"server never healthy ({last})")
    basic = base64.b64encode(b"admin:password").decode()
    req = urllib.request.Request(
        f"{CLICKHOUSE}/?query=SELECT%201",
        headers={"Authorization": "Basic " + basic}, method="GET",
    )
    for _ in range(60):
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
    raise RuntimeError("clickhouse never ready")


def provision():
    xhr = {"X-Requested-With": "XMLHttpRequest"}
    # /api/health is static (200 the moment the server listens) and does not
    # gate on DB seeding — the seeded admin may not exist yet when
    # wait-for-stack passes (argon2 hashing is slow on shared CI CPUs).
    # Poll login briefly rather than failing the whole matrix on the race.
    status, payload = 0, {}
    for _ in range(15):
        status, payload = api("POST", "/api/rbac/auth/login",
            body={"identifier": "admin@localhost", "password": "admin123!"},
            extra_headers=xhr)
        if status == 200:
            break
        time.sleep(2)
    assert status == 200, f"login {status}: {payload}"
    jwt = payload["data"]["tokens"]["accessToken"]
    STATE["admin_jwt"] = jwt
    status, payload = api("POST", "/api/rbac/connections", token=jwt, body={
        "name": CONN_NAME, "host": "clickhouse.", "port": 8123,
        "username": "admin", "password": "password",
    }, extra_headers=xhr)
    assert status == 201, f"connection {status}: {payload}"
    conn = payload["data"]["id"]
    STATE["connection_id"] = conn
    status, payload = api("PATCH", f"/api/rbac/connections/{conn}",
        token=jwt, body={"isDefault": True}, extra_headers=xhr)
    assert status == 200, f"default {status}: {payload}"
    status, payload = api("POST", "/api/rbac/pats", token=jwt,
        body={"name": f"e2e-cli-{TAG}"}, extra_headers=xhr)
    assert status == 201, f"pat {status}: {payload}"
    assert payload["data"]["rawToken"].startswith("ch_pat_")
    STATE["pat"] = payload["data"]["rawToken"]
    STATE["pat_id"] = payload["data"]["token"]["id"]


# ---------- phase 2: CLI matrix ----------

def t_status():
    out = need(cli("status", "--output", "json", pat=False))
    data = json.loads(out)
    assert "health" in data and "rbac" in data, data.keys()
    assert "login required" in out, out[-300:]


def t_auth_cycle():
    out = need(cli("auth", "status", "--output", "json"))
    assert "masked" in out and STATE["pat"] not in out, out
    out = need(cli("auth", "whoami", "--output", "json"))
    assert "admin" in out, out[-300:]
    # login stores, then stored creds work without env
    need(cli("auth", "login", "--token", STATE["pat"]))
    out = need(cli("auth", "whoami", "--output", "json", pat=False))
    assert "admin" in out, out[-300:]
    need(cli("auth", "logout", pat=False))


def t_connection():
    out = need(cli("connection", "list", "--output", "json"))
    assert CONN_NAME in out, out[-500:]
    out = need(cli("connection", "can-i", "system", "numbers", "--output", "json"))
    assert out.strip(), "empty can-i output"


def t_query_reads():
    out = need(cli("query", "SELECT 6*7 AS x", "--output", "json"))
    assert "42" in out, out[-500:]
    need(cli("query", "--explain", "plan", "SELECT * FROM system.numbers LIMIT 1"))
    p = cli("query", "DROP TABLE t")
    assert p.returncode == 2, f"raw DDL without --raw must fail, got {p.returncode}"


def t_guarded_writes():
    need(cli("query", "--raw", "--yes", f"CREATE DATABASE IF NOT EXISTS {DB}"))
    need(cli("query", "--raw", "--yes",
             f"CREATE TABLE IF NOT EXISTS {DB}.t (id UInt32) ENGINE = MergeTree() ORDER BY id"))
    need(cli("query", "--raw", "--yes", f"INSERT INTO {DB}.t VALUES (1)(2)(3)"))
    out = need(cli("query", f"SELECT count() AS c FROM {DB}.t", "--output", "json"))
    assert "3" in out, out[-500:]
    # --dry-run previews without executing
    out = need(cli("query", "--raw", "--yes", "--dry-run",
                   f"ALTER TABLE {DB}.t UPDATE id = 9 WHERE id = 1"))
    assert "dry_run" in out, out[-500:]
    out = need(cli("table", "schema", f"{DB}", "t", "--output", "json"))
    assert "MergeTree" in out, out[-500:]
    out = need(cli("table", "sample", f"{DB}", "t", "--output", "json"))
    assert '"id"' in out or "id" in out, out[-500:]


def t_saved():
    out = need(cli("saved", "create", "--name", f"e2e-six-seven-{TAG}",
                   "--query", "SELECT 6*7 AS x", "--output", "json"))
    sid = json.loads(out)
    # unwrap {data:{id}} or {id}
    _id = (sid.get("data") or {}).get("id", sid.get("id"))
    assert _id, f"no saved id: {out[-300:]}"
    STATE["saved_id"] = _id
    out = need(cli("saved", "list", "--output", "json"))
    assert f"e2e-six-seven-{TAG}" in out, out[-500:]
    out = need(cli("saved", "run", _id, "--output", "json"))
    assert "42" in out, out[-500:]
    need(cli("saved", "delete", _id, "--yes"))


def t_metrics_logs_live():
    # Warm up system.query_log (lazily materialized on fresh ClickHouse).
    cli("query", "SELECT count() FROM system.query_log", "--output", "json")
    need(cli("metrics", "overview", "--output", "json"))
    need(cli("metrics", "top-tables", "--output", "json"))
    need(cli("metrics", "errors", "--output", "json"))
    need(cli("metrics", "simulate", f"ALTER TABLE {DB}.t UPDATE id = 1 WHERE id = 2"))
    need(cli("logs", "queries", "--output", "json"))
    need(cli("live", "list", "--output", "json"))
    # Real kill through the attributed path: keep SELECT sleep(2) queries in
    # flight via the CLI itself (this ClickHouse caps sleep() at 3s, so one
    # long sleep dies instantly), find an instance, kill it by query_id, and
    # confirm THAT id is gone. Queries carry the PAT, so they are attributed
    # to our rbac user and visible without kill_all.
    import subprocess as _sp  # noqa: E402

    _env = dict(os.environ, CHOUSE_SERVER=BASE, CH_HOUSE_PAT=STATE["pat"])
    if "connection_id" in STATE:
        _env.setdefault("CHOUSE_CONNECTION", STATE["connection_id"])
    loop = _sp.Popen(
        ["bash", "-c",
         "for i in $(seq 1 30); do /usr/local/bin/chouse query 'SELECT sleep(2)'; done"],
        stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, env=_env)
    qid = ""
    try:
        for i in range(25):
            time.sleep(1)
            out = need(cli("live", "list", "--output", "json"))
            if i == 0:
                # Decisive diagnostics if the loop rows stay invisible.
                print("DIAG live[0]:", out[:400], flush=True)
            try:
                payload = json.loads(out)
                # CLI unwraps the envelope: {queries,connectionId,total}.
                data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
                rows = (data or {}).get("queries") or []
            except (ValueError, AttributeError):
                rows = []
            hits = [r for r in rows
                    if isinstance(r, dict) and "sleep(2)" in str(r.get("query", ""))]
            if hits:
                qid = str(hits[0].get("query_id") or hits[0].get("queryId") or "")
                break
        assert qid, "CLI-launched sleep(2) loop never appeared in live list"
        need(cli("live", "kill", qid, "--yes"))
        for _ in range(20):
            time.sleep(1)
            out = need(cli("live", "list", "--output", "json"))
            try:
                payload = json.loads(out)
                data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
                ids = [str(r.get("query_id") or r.get("queryId") or "")
                       for r in (data or {}).get("queries") or []]
            except (ValueError, AttributeError):
                ids = []
            if qid not in ids:
                break
        else:
            raise AssertionError(f"killed query {qid} still listed")
    finally:
        loop.terminate()
        try:
            loop.wait(timeout=15)
        except Exception:  # noqa: BLE001
            loop.kill()


def t_fleet_doctor():
    need(cli("fleet", "list", "--output", "json"))
    need(cli("fleet", "history", "--limit", "5", "--output", "json"))
    need(cli("doctor", "reports", "--output", "json"))
    need(cli("doctor", "schedule", "--output", "json"))


def t_ops_domains():
    need(cli("scheduled", "list", "--output", "json"))
    need(cli("scheduled", "preview", "--output", "json"))
    need(cli("health", "list", "--output", "json"))
    need(cli("health", "incidents", "--output", "json"))
    need(cli("alert", "channels", "--output", "json"))
    need(cli("alert", "rules", "--output", "json"))
    need(cli("alert", "events", "--output", "json"))
    need(cli("ai", "capabilities", "--output", "json"))
    need(cli("ai", "models", "--output", "json"))
    need(cli("audit", "list", "--output", "json"))


def t_upload_preview():
    with open("/tmp/rows.csv", "w", encoding="utf-8") as fh:
        fh.write("id,name\n1,ada\n2,grace\n")
    need(cli("upload", "preview", "--file", "/tmp/rows.csv", "--output", "json"))


def t_exit_codes_and_fence():
    p = cli("auth", "whoami", pat=False)
    assert p.returncode == 3, f"missing PAT must exit 3, got {p.returncode}"
    p = cli("auth", "whoami", env_extra={"CH_HOUSE_PAT": "ch_pat_bogus"})
    assert p.returncode == 3, f"bad PAT must exit 3, got {p.returncode}: {p.stderr[-300:]}"
    p = cli("connection", "create")
    assert p.returncode == 2 and "UI-only" in p.stderr, p.stderr[-300:]
    p = cli("audit", "list", "--output", "bogus")
    assert p.returncode == 2, f"bad --output must exit 2, got {p.returncode}"


def t_version_offline():
    # No server/PAT/config: version must be instant, local-only output.
    start = time.time()
    p = cli_scrubbed("version", "--output", "json")
    elapsed = time.time() - start
    assert p.returncode == 0, f"version exit={p.returncode}: {p.stderr[-300:]}"
    assert elapsed < 5, f"version took {elapsed:.1f}s without a server (network wait?)"
    data = json.loads(p.stdout)
    assert "cli" in data, data.keys()
    assert "server" not in data and "unreachable" not in p.stdout, p.stdout[-300:]


def t_no_server_fail_fast():
    # Commands needing a server fail fast (exit 2) with setup guidance,
    # never a phantom-localhost NETWORK_ERROR.
    for args in (["status", "--output", "json"], ["query", "SELECT 1"]):
        p = cli_scrubbed(*args)
        assert p.returncode == 2, f"{args} exit={p.returncode}: {p.stderr[-300:]}"
        assert "no server configured" in p.stderr, p.stderr[-300:]


def t_auth_status_unconfigured():
    p = cli_scrubbed("auth", "status", "--output", "json")
    assert p.returncode == 0, f"auth status exit={p.returncode}: {p.stderr[-300:]}"
    assert "(not configured)" in p.stdout, p.stdout[-300:]


def t_login_persists_server():
    # login --server/--token once, then everything works with zero env:
    # server AND token both come from disk.
    import tempfile as _tf  # noqa: E402
    home = _tf.mkdtemp(prefix="chouse-e2e-login-")
    out = need(cli_scrubbed("auth", "login", "--server", BASE,
                            "--token", STATE["pat"], home=home))
    assert "stored PAT" in out, out[-300:]
    out = need(cli_scrubbed("auth", "status", "--output", "json", home=home))
    data = json.loads(out)
    assert data["server"] == BASE, out[-300:]
    assert STATE["pat"] not in out, "raw PAT must never render"
    out = need(cli_scrubbed("auth", "whoami", "--output", "json", home=home))
    assert "admin" in out, out[-300:]


def t_cleanup_writes():
    need(cli("query", "--raw", "--yes", f"DROP TABLE IF EXISTS {DB}.t"))
    need(cli("query", "--raw", "--yes", f"DROP DATABASE IF EXISTS {DB}"))


def t_cleanup_identity():
    # Best-effort: remove this run's connection + PAT via the stored JWT so
    # reruns don't accumulate. Never fails the matrix.
    jwt = STATE.get("admin_jwt", "")
    xhr = {"X-Requested-With": "XMLHttpRequest"}
    try:
        status, payload = api("DELETE", f"/api/rbac/connections/{STATE['connection_id']}",
                              token=jwt, extra_headers=xhr)
        print(f"CLEANUP connection: {status}", flush=True)
    except Exception as error:  # noqa: BLE001
        print(f"CLEANUP connection skipped ({error})", flush=True)
    try:
        pats = STATE.get("pat_id") or ""
        if not pats:
            status, payload = api("GET", "/api/rbac/pats", token=jwt, extra_headers=xhr)
            mine = [t for t in payload.get("data", {}).get("tokens", [])
                    if t.get("name") == f"e2e-cli-{TAG}"]
            pats = mine[0]["id"] if mine else ""
        if pats:
            status, _ = api("DELETE", f"/api/rbac/pats/{pats}", token=jwt, extra_headers=xhr)
            print(f"CLEANUP pat: {status}", flush=True)
    except Exception as error:  # noqa: BLE001
        print(f"CLEANUP pat skipped ({error})", flush=True)


def main():
    check("wait-for-stack", wait_for_stack)
    if FAILURES:
        sys.exit(1)
    check("provision", provision)
    if FAILURES:
        sys.exit(1)
    for name, fn in [
        ("cli-status", t_status),
        ("cli-auth-cycle", t_auth_cycle),
        ("cli-connection", t_connection),
        ("cli-query-reads", t_query_reads),
        ("cli-guarded-writes", t_guarded_writes),
        ("cli-saved", t_saved),
        ("cli-metrics-logs-live", t_metrics_logs_live),
        ("cli-fleet-doctor", t_fleet_doctor),
        ("cli-ops-domains", t_ops_domains),
        ("cli-upload-preview", t_upload_preview),
        ("cli-exit-codes-fence", t_exit_codes_and_fence),
        ("cli-version-offline", t_version_offline),
        ("cli-no-server-fail-fast", t_no_server_fail_fast),
        ("cli-auth-status-unconfigured", t_auth_status_unconfigured),
        ("cli-login-persists-server", t_login_persists_server),
        ("cli-cleanup-writes", t_cleanup_writes),
        ("cli-cleanup-identity", t_cleanup_identity),
    ]:
        check(name, fn)
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES: {FAILURES}", flush=True)
        sys.exit(1)
    print("ALL CHECKS PASSED", flush=True)


main()
