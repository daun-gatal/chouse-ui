#!/usr/bin/env python3
"""Output-style matrix for the chouse CLI (ADR 0018).

Runs INSIDE the compose network (like e2e-cli-check.py) against a real
server and ClickHouse. It discovers every leaf command from `--help`, runs
each one in every output style and validates the result mechanically:

  table  header line, not JSON, same header and row count as csv
  csv    parses, every row as wide as the header
  json   parses
  yaml   parses
  auto   piped: JSON shaped like -o json; on a pseudo-terminal: a table with
         the same header as -o table

Commands that print a raw document by design (config get, mcp config,
audit export) must print the same bytes in every style; commands with no
stdout by design (config set/unset/use-profile/delete-profile) must print
nothing; commands that cannot succeed in this stack (no AI model, the
proposer approving their own fix) must fail the same way in every style
with nothing on stdout. A leaf command missing from the matrix fails the run.

Prints `MATRIX-JSON <json>` with every result for the report, then exits
non-zero if any check failed.
"""

import base64
import csv
import io
import json
import os
import pty
import re
import select
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import yaml

BASE = "http://chouse-ui:5521"
CLICKHOUSE = "http://clickhouse:8123"
CHOUSE = "/usr/local/bin/chouse"
TAG = str(int(time.time()))[-5:]
DB = f"e2e_fmt_{TAG}"
CONN = f"e2e-fmt-{TAG}"
STYLES = ["table", "csv", "json", "yaml", "auto-piped", "auto-tty"]
STATE: dict = {}
XHR = {"X-Requested-With": "XMLHttpRequest"}


def api(method, path, *, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", **XHR}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            ctype = resp.headers.get("Content-Type", "")
            return resp.status, (json.loads(raw or "{}") if "json" in ctype else raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return error.code, raw


def mcp_call(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(BASE + "/mcp", data=body, method="POST", headers={
        "Authorization": f"Bearer {STATE['pat']}", "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.status


def env(home=None):
    e = dict(os.environ)
    e.update({"CHOUSE_SERVER": BASE, "CH_HOUSE_PAT": STATE["pat"], "CHOUSE_CONNECTION": STATE["conn"],
              "HOME": home or STATE["home"], "CHOUSE_OUTPUT": "", "CHOUSE_PROFILE": ""})
    return e


def chouse(args, *, home=None, stdin_text=None):
    p = subprocess.run([CHOUSE, *args], capture_output=True, text=True, input=stdin_text, timeout=120, env=env(home))
    return p.returncode, p.stdout, p.stderr


def chouse_tty(args, *, home=None, stdin_text=None):
    """Run with stdout on a pseudo-terminal (stdin stays a pipe)."""
    master, slave = pty.openpty()
    p = subprocess.Popen([CHOUSE, *args], stdin=subprocess.PIPE, stdout=slave, stderr=subprocess.PIPE, env=env(home))
    os.close(slave)
    p.stdin.write((stdin_text or "").encode())
    p.stdin.close()
    chunks = []
    while True:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
        elif p.poll() is not None:
            try:
                while True:
                    data = os.read(master, 65536)
                    if not data:
                        break
                    chunks.append(data)
            except OSError:
                pass
            break
    os.close(master)
    err = p.stderr.read().decode()
    p.wait(timeout=120)
    return p.returncode, b"".join(chunks).decode().replace("\r\n", "\n"), err


# ---------- provisioning ----------

def wait_for_stack():
    for _ in range(90):
        try:
            if api("GET", "/api/health")[0] == 200:
                break
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
    basic = base64.b64encode(b"admin:password").decode()
    req = urllib.request.Request(f"{CLICKHOUSE}/?query=SELECT%201", headers={"Authorization": "Basic " + basic})
    for _ in range(60):
        try:
            with urllib.request.urlopen(req, timeout=10):
                return
        except Exception:  # noqa: BLE001
            time.sleep(2)
    raise RuntimeError("clickhouse never ready")


def need(status, payload, ok=(200, 201)):
    assert status in ok, f"{status}: {str(payload)[:300]}"
    return payload["data"] if isinstance(payload, dict) and "data" in payload else payload


def provision():
    for _ in range(15):
        status, payload = api("POST", "/api/rbac/auth/login", body={"identifier": "admin@localhost", "password": "admin123!"})
        if status == 200:
            break
        time.sleep(2)
    jwt = need(status, payload)["tokens"]["accessToken"]
    STATE["jwt"] = jwt
    STATE["conn"] = need(*api("POST", "/api/rbac/connections", token=jwt, body={
        "name": CONN, "host": "clickhouse.", "port": 8123, "username": "admin", "password": "password"}))["id"]
    STATE["pat"] = need(*api("POST", "/api/rbac/pats", token=jwt, body={"name": f"e2e-fmt-{TAG}"}))["rawToken"]
    STATE["home"] = tempfile.mkdtemp(prefix="chouse-fmt-")

    def sql(statement):
        code, out, err = chouse(["query", "--raw", "--yes", statement])
        assert code == 0, f"{statement}: {err}"

    sql(f"CREATE DATABASE IF NOT EXISTS {DB}")
    sql(f"CREATE TABLE IF NOT EXISTS {DB}.t (id UInt32, name String, ts DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY id")
    sql(f"INSERT INTO {DB}.t (id, name) VALUES (1, 'ada'), (2, 'grace, \"the admiral\"'), (3, 'margaret')")

    pool = lambda n, fn: [fn(i) for i in range(n)]  # noqa: E731
    STATE["saved"] = pool(len(STYLES) + 1, lambda i: need(*api("POST", "/api/saved-queries", token=jwt, body={
        "name": f"fmt-{TAG}-{i}", "query": f"SELECT id, name FROM {DB}.t ORDER BY id", "connectionId": STATE["conn"]}))["id"])
    job = lambda i: need(*api("POST", "/api/scheduled-queries", token=jwt, body={  # noqa: E731
        "name": f"fmt-job-{TAG}-{i}", "connectionId": STATE["conn"], "query": f"SELECT count() FROM {DB}.t", "frequency": "manual"}))
    jobs = []
    for i in range(len(STYLES) + 1):
        created = job(i)
        jobs.append((created.get("job") or created)["id"])
    STATE["jobs"] = jobs
    need(*api("POST", f"/api/scheduled-queries/{jobs[0]}/run", token=jwt))
    channel = need(*api("POST", "/api/alerting/channels", token=jwt, body={
        "name": f"fmt-hook-{TAG}", "type": "webhook", "config": {"url": "http://127.0.0.1:9/unreachable"}}))
    STATE["channel"] = (channel.get("channel") or channel)["id"]
    promise = need(*api("POST", "/api/data-health", token=jwt, body={
        "name": f"fmt-promise-{TAG}", "connectionId": STATE["conn"],
        "source": {"sourceType": "table", "databaseName": DB, "tableName": "t", "eventTimeColumn": "ts", "eventTimeType": "DateTime", "eventTimeEncoding": "native"},
        "frequency": "manual", "breachAfter": 1, "runNow": True,
        "checks": [{"checkKey": "rows", "name": "At least 1000 rows", "type": "row_count", "severity": "critical", "config": {"min": 1000}}]}))
    STATE["promise"] = promise["promise"]["id"]
    incident = None
    for _ in range(20):
        incidents = need(*api("GET", "/api/data-health/incidents", token=jwt))["incidents"]
        mine = [i for i in incidents if i.get("promiseId") == STATE["promise"]]
        if mine:
            incident = mine[0]["id"]
            break
        api("POST", f"/api/data-health/{STATE['promise']}/run", token=jwt)
        time.sleep(1)
    assert incident, "the breaching promise never opened an incident"
    STATE["incident"] = incident
    actions = []
    for i in range(2 * len(STYLES) + 1):
        created = need(*api("POST", "/api/remediation/actions", token=jwt, body={
            "connectionId": STATE["conn"], "params": {"type": "kill_query", "queryId": f"fmt-{TAG}-{i}"}, "rationale": "output matrix"}))
        actions.append((created.get("action") or created)["id"])
    STATE["actions"] = actions
    need(*api("PUT", "/api/agents/mcp", token=jwt, body={"enabled": True}))
    mcp_call("tools/call", {"name": "whoami", "arguments": {}})
    sessions = need(*api("GET", "/api/agents/sessions", token=jwt))["sessions"]
    STATE["session"] = sessions[0]["id"]
    with open("/tmp/rows.csv", "w", encoding="utf-8") as fh:
        fh.write("id,name\n1,ada\n2,grace\n")
    # system.query_log appears after ClickHouse's first log flush.
    for _ in range(30):
        if chouse(["query", "SELECT count() FROM system.query_log"])[0] == 0:
            break
        time.sleep(1)


# ---------- matrix ----------

def pick(key):
    """A fresh target per run for commands that consume one."""
    return lambda: STATE[key].pop()


# kind: "rendered" (exit 0, validated per style), "raw" (same bytes in
# every style), "silent" (no stdout), "error" (fails the same way, no stdout).
MATRIX = {
    "status": ("rendered", lambda: ["status"]),
    "version": ("rendered", lambda: ["version"]),
    "auth login": ("rendered", lambda: ["auth", "login", "--token-stdin"]),
    "auth status": ("rendered", lambda: ["auth", "status"]),
    "auth whoami": ("rendered", lambda: ["auth", "whoami"]),
    "auth logout": ("rendered", lambda: ["auth", "logout"]),
    "config view": ("rendered", lambda: ["config", "view"]),
    "config profiles": ("rendered", lambda: ["config", "profiles"]),
    "config get": ("raw", lambda: ["config", "get", "server"]),
    "config set": ("silent", lambda: ["config", "set", "output", "auto"]),
    "config unset": ("silent", lambda: ["config", "unset", "connection"]),
    "config use-profile": ("silent", lambda: ["config", "use-profile", "default"]),
    "config delete-profile": ("silent", lambda: ["config", "delete-profile", "scratch", "--yes"]),
    "connection list": ("rendered", lambda: ["connection", "list"]),
    "connection get": ("rendered", lambda: ["connection", "get", CONN]),
    "connection test": ("rendered", lambda: ["connection", "test", CONN]),
    "connection can-i": ("rendered", lambda: ["connection", "can-i", DB, "t"]),
    "query": ("rendered", lambda: ["query", f"SELECT id, name, ts FROM {DB}.t ORDER BY id"]),
    "table list": ("rendered", lambda: ["table", "list", DB]),
    "table schema": ("rendered", lambda: ["table", "schema", f"{DB}.t"]),
    "table sample": ("rendered", lambda: ["table", "sample", f"{DB}.t", "--limit", "3"]),
    "saved list": ("rendered", lambda: ["saved", "list"]),
    "saved get": ("rendered", lambda: ["saved", "get", STATE["saved"][0]]),
    "saved create": ("rendered", lambda: ["saved", "create", "--name", f"fmt-new-{time.time_ns()}", "SELECT 1 AS x"]),
    "saved run": ("rendered", lambda: ["saved", "run", STATE["saved"][0]]),
    "saved delete": ("rendered", lambda: ["saved", "delete", STATE["saved"].pop(), "--yes"]),
    "upload preview": ("rendered", lambda: ["upload", "preview", "/tmp/rows.csv"]),
    "metrics overview": ("rendered", lambda: ["metrics", "overview"]),
    "metrics top-tables": ("rendered", lambda: ["metrics", "top-tables"]),
    "metrics errors": ("rendered", lambda: ["metrics", "errors"]),
    "metrics parts-pressure": ("rendered", lambda: ["metrics", "parts-pressure"]),
    "metrics custom": ("rendered", lambda: ["metrics", "custom", "--query", "SELECT 1 AS x"]),
    "metrics simulate": ("rendered", lambda: ["metrics", "simulate", f"ALTER TABLE {DB}.t DELETE WHERE id = 3"]),
    "logs": ("rendered", lambda: ["logs", "--limit", "5"]),
    "live list": ("rendered", lambda: ["live", "list"]),
    "live kill": ("rendered", lambda: ["live", "kill", f"no-such-query-{time.time_ns()}", "--yes"]),
    "fleet list": ("rendered", lambda: ["fleet", "list"]),
    "fleet history": ("rendered", lambda: ["fleet", "history", "--limit", "3"]),
    "fleet query": ("rendered", lambda: ["fleet", "query", "summary"]),
    "scheduled list": ("rendered", lambda: ["scheduled", "list"]),
    "scheduled get": ("rendered", lambda: ["scheduled", "get", STATE["jobs"][0]]),
    "scheduled runs": ("rendered", lambda: ["scheduled", "runs", STATE["jobs"][0]]),
    "scheduled preview": ("rendered", lambda: ["scheduled", "preview", "--query", f"SELECT count() FROM {DB}.t"]),
    "scheduled run": ("rendered", lambda: ["scheduled", "run", STATE["jobs"][0], "--yes"]),
    "scheduled delete": ("rendered", lambda: ["scheduled", "delete", STATE["jobs"].pop(), "--yes"]),
    "alert channels": ("rendered", lambda: ["alert", "channels"]),
    "alert rules": ("rendered", lambda: ["alert", "rules"]),
    "alert events": ("rendered", lambda: ["alert", "events", "--limit", "5"]),
    # The webhook points nowhere: the server reports the failed delivery (502).
    "alert test": ("error", lambda: ["alert", "test", STATE["channel"], "--yes"]),
    "audit list": ("rendered", lambda: ["audit", "list", "--limit", "5", "--action", "saved_query.create"]),
    "audit export": ("raw", lambda: ["audit", "export", "--limit", "5", "--action", "auth.login"]),
    "health list": ("rendered", lambda: ["health", "list"]),
    "health incidents": ("rendered", lambda: ["health", "incidents"]),
    "health timeline": ("rendered", lambda: ["health", "timeline", STATE["promise"], "--limit", "5"]),
    "health dataset": ("rendered", lambda: ["health", "dataset", f"{DB}.t"]),
    "health run": ("rendered", lambda: ["health", "run", STATE["promise"], "--yes"]),
    "health ack": ("rendered", lambda: ["health", "ack", STATE["incident"], "--yes"]),
    "lineage": ("rendered", lambda: ["lineage", f"{DB}.t"]),
    "incidents": ("rendered", lambda: ["incidents", "--all"]),
    "remediation list": ("rendered", lambda: ["remediation", "list"]),
    "remediation get": ("rendered", lambda: ["remediation", "get", STATE["actions"][0]]),
    "remediation reject": ("rendered", lambda: ["remediation", "reject", STATE["actions"].pop(), "--comment", "matrix", "--yes"]),
    # A person may approve their own low-risk (class 1) proposal.
    "remediation approve": ("rendered", lambda: ["remediation", "approve", STATE["actions"].pop(), "--comment", "matrix", "--yes"]),
    "ai capabilities": ("rendered", lambda: ["ai", "capabilities"]),
    "ai models": ("rendered", lambda: ["ai", "models"]),
    # This stack has no AI model configured: the server refuses the call.
    "ai optimize": ("error", lambda: ["ai", "optimize", "SELECT 1", "--yes"]),
    "doctor reports": ("rendered", lambda: ["doctor", "reports"]),
    "doctor schedule": ("rendered", lambda: ["doctor", "schedule"]),
    "doctor scan": ("error", lambda: ["doctor", "scan", "--yes"]),
    # No AI model, so no Doctor report exists to fetch.
    "doctor get": ("error", lambda: ["doctor", "get", "no-such-report"]),
    "agents summary": ("rendered", lambda: ["agents", "summary"]),
    "agents sessions": ("rendered", lambda: ["agents", "sessions"]),
    "agents session": ("rendered", lambda: ["agents", "session", STATE["session"]]),
    "agents policies": ("rendered", lambda: ["agents", "policies"]),
    "mcp status": ("rendered", lambda: ["mcp", "status"]),
    "mcp tools": ("rendered", lambda: ["mcp", "tools"]),
    "mcp settings": ("rendered", lambda: ["mcp", "settings"]),
    "mcp config": ("raw", lambda: ["mcp", "config", "cursor"]),
}

# Commands that write local config run in their own HOME, seeded first.
LOCAL = {"auth login", "auth logout", "config view", "config profiles", "config get", "config set", "config unset",
         "config use-profile", "config delete-profile"}


def discover(path=()):
    """Every leaf command, from the help output."""
    code, out, _ = chouse([*path, "--help"])
    assert code == 0, f"help for {path}"
    names = []
    section = False
    for line in out.splitlines():
        if line.endswith(":") and not line.startswith(" "):
            section = line in ("Available Commands:",) or line.rstrip(":") in (
                "Getting started", "Query and explore", "Operate", "Data observability", "AI and agents", "Additional Commands")
            continue
        m = re.match(r"^  ([a-z][a-z0-9-]*)\s+\S", line)
        if section and m and m.group(1) not in ("help", "completion"):
            names.append(m.group(1))
    if not names:
        return [" ".join(path)]
    leaves = []
    for name in names:
        leaves += discover((*path, name))
    return leaves


def table_header(text):
    first = text.strip("\n").split("\n")[0]
    return [cell for cell in re.split(r"\s{2,}", first.strip())]


def validate(style, out):
    """Return None when out is valid for style, else the reason."""
    if not out.strip():
        return "empty stdout"
    try:
        if style in ("json", "auto-piped"):
            json.loads(out)
        elif style == "yaml":
            yaml.safe_load(out)
        elif style == "csv":
            rows = list(csv.reader(io.StringIO(out)))
            widths = {len(r) for r in rows}
            if len(widths) != 1:
                return f"ragged csv rows: widths {sorted(widths)}"
        elif style in ("table", "auto-tty"):
            if out.lstrip()[:1] in ("{", "["):
                return "looks like JSON, not a table"
            header = table_header(out)
            if not all(re.fullmatch(r"[A-Z0-9_. -]+", h) for h in header):
                return f"header is not uppercase column names: {header}"
    except Exception as error:  # noqa: BLE001
        return f"does not parse: {error}"
    return None


def json_shape(text):
    return value_shape(json.loads(text))


def value_shape(value):
    if isinstance(value, dict):
        return ("object", sorted(value.keys()))
    if isinstance(value, list):
        return ("list", sorted(value[0].keys()) if value and isinstance(value[0], dict) else None)
    return (type(value).__name__, None)


def run_style(name, args, style, home):
    stdin = STATE["pat"] + "\n" if name == "auth login" else None
    if style == "auto-tty":
        return chouse_tty(args, home=home, stdin_text=stdin)
    if style == "auto-piped":
        return chouse(args, home=home, stdin_text=stdin)
    return chouse([*args, "-o", style], home=home, stdin_text=stdin)


def seed_local_home():
    home = tempfile.mkdtemp(prefix="chouse-fmt-local-")
    for args in (["config", "set", "server", BASE], ["config", "set", "connection", CONN], ["config", "set", "server", BASE, "--profile", "scratch"]):
        code, _, err = chouse(args, home=home)
        assert code == 0, err
    code, _, err = chouse(["auth", "login", "--token-stdin"], home=home, stdin_text=STATE["pat"] + "\n")
    assert code == 0, err
    return home


def main():
    wait_for_stack()
    provision()
    leaves = sorted(discover())
    results = []
    failures = []
    missing = [leaf for leaf in leaves if leaf not in MATRIX]
    extra = [name for name in MATRIX if name not in leaves]
    for leaf in missing:
        failures.append(f"{leaf}: not in the matrix")
    for name in extra:
        failures.append(f"{name}: in the matrix but not a command")

    for name in leaves:
        if name not in MATRIX:
            continue
        kind, make_args = MATRIX[name]
        row = {"command": name, "kind": kind, "styles": {}}
        outputs = {}
        for style in STYLES:
            home = seed_local_home() if name in LOCAL else STATE["home"]
            args = make_args()
            code, out, err = run_style(name, args, style, home)
            outputs[style] = out
            problem = None
            if kind == "error":
                if code == 0:
                    problem = "expected the server to refuse"
                elif out.strip():
                    problem = "stdout must stay empty on an error"
                elif not any(line.startswith("error: ") for line in err.splitlines()):
                    problem = "stderr must carry an 'error: ' line"
            elif code != 0:
                problem = f"exit {code}: {err.strip()[:300]}"
            elif kind == "silent":
                problem = "stdout must be empty" if out.strip() else None
            elif kind == "raw":
                problem = None if out.strip() else "empty stdout"
            elif not out.strip() and style in ("table", "csv", "auto-tty"):
                # An empty result: nothing on stdout, said on stderr.
                problem = None if "No results." in err else "empty stdout without a 'No results.' note"
                row.setdefault("empty", True)
            else:
                problem = validate(style, out)
            row["styles"][style] = {"ok": problem is None, "problem": problem, "exit": code,
                                    "args": " ".join(args + ([] if style.startswith("auto") else ["-o", style])),
                                    "stdout": out[:1500], "stderr": err[:300]}
        # Cross-style consistency.
        checks = []
        if kind == "rendered" and row.get("empty") and all(row["styles"][s]["ok"] for s in STYLES):
            checks.append(("empty in table, csv and on a terminal", not outputs["table"].strip() and not outputs["csv"].strip() and not outputs["auto-tty"].strip(), ""))
            checks.append(("auto piped is JSON shaped like -o json", json_shape(outputs["auto-piped"]) == json_shape(outputs["json"]), ""))
        elif kind == "rendered" and all(row["styles"][s]["ok"] for s in STYLES):
            th, ch = table_header(outputs["table"]), next(csv.reader(io.StringIO(outputs["csv"])))
            checks.append(("table header == csv header", [h.upper() for h in ch] == th, f"{th} vs {ch}"))
            t_rows = len(outputs["table"].strip("\n").split("\n")) - 1
            c_rows = len(list(csv.reader(io.StringIO(outputs["csv"])))) - 1
            checks.append(("table rows == csv rows", t_rows == c_rows, f"{t_rows} vs {c_rows}"))
            checks.append(("auto piped is JSON shaped like -o json", json_shape(outputs["auto-piped"]) == json_shape(outputs["json"]),
                           f"{json_shape(outputs['auto-piped'])} vs {json_shape(outputs['json'])}"))
            checks.append(("auto on a terminal is the table", table_header(outputs["auto-tty"]) == th, f"{table_header(outputs['auto-tty'])} vs {th}"))
            checks.append(("yaml decodes to the shape of json", value_shape(yaml.safe_load(outputs["yaml"])) == json_shape(outputs["json"]),
                           f"{value_shape(yaml.safe_load(outputs['yaml']))} vs {json_shape(outputs['json'])}"))
        if kind == "raw":
            same = len({outputs[s] for s in ("table", "csv", "json", "yaml", "auto-piped")}) == 1
            checks.append(("same bytes in every style", same, ""))
        row["checks"] = [{"name": n, "ok": ok, "detail": d} for n, ok, d in checks]
        for style, res in row["styles"].items():
            if not res["ok"]:
                failures.append(f"{name} [{style}]: {res['problem']}")
        for check in row["checks"]:
            if not check["ok"]:
                failures.append(f"{name}: {check['name']} ({check['detail']})")
        status = "ok" if all(r["ok"] for r in row["styles"].values()) and all(c["ok"] for c in row["checks"]) else "FAIL"
        print(f"{status:4} {name}", flush=True)
        results.append(row)

    print("MATRIX-JSON " + json.dumps({"leaves": leaves, "results": results, "failures": failures, "styles": STYLES}), flush=True)
    if failures:
        print(f"{len(failures)} FAILURES", flush=True)
        for f in failures:
            print("  - " + f, flush=True)
        sys.exit(1)
    print(f"ALL {len(results)} COMMANDS x {len(STYLES)} STYLES PASSED", flush=True)


main()
