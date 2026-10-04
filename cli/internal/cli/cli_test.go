package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/config"
)

const prodID = "57c2b5bf-0081-4880-9a05-057d1ec3b098"

type seen struct {
	mu       sync.Mutex
	requests []*http.Request
	bodies   []string
}

func (s *seen) add(r *http.Request, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, r)
	s.bodies = append(s.bodies, body)
}

func (s *seen) paths() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.requests))
	for i, r := range s.requests {
		out[i] = r.Method + " " + r.URL.Path
	}
	return out
}

// fakeServer answers the routes the tests use with the {success,data}
// envelope and records every request.
func fakeServer(t *testing.T) (*httptest.Server, *seen) {
	t.Helper()
	rec := &seen{}
	ok := func(w http.ResponseWriter, data any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rec.add(r.Clone(context.Background()), string(raw))
		switch r.URL.Path {
		case "/api/rbac/connections/my":
			ok(w, []any{map[string]any{"id": prodID, "name": "prod", "host": "ch.prod"}, map[string]any{"id": "other-id", "name": "staging", "host": "ch.stg"}})
		case "/api/explorer/databases":
			ok(w, []any{map[string]any{"name": "shop", "children": []any{map[string]any{"name": "orders", "type": "table", "engine": "MergeTree", "size": float64(2048)}}}})
		case "/api/query/table/select":
			ok(w, map[string]any{
				"meta":       []any{map[string]any{"name": "z"}, map[string]any{"name": "a"}},
				"data":       []any{map[string]any{"a": "x,y", "z": float64(1)}},
				"statistics": map[string]any{"elapsed": 0.01, "rows_read": float64(1)},
			})
		case "/api/metrics/ddl/simulate":
			ok(w, map[string]any{"rowsAffected": float64(42)})
		case "/api/rbac/auth/validate":
			ok(w, map[string]any{"valid": true})
		case "/api/live-queries":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Request-Id", "req-123")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"success":false,"error":{"code":"FORBIDDEN","message":"Permission 'live_queries:view' required"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

type result struct {
	out, err string
	code     int
}

// run executes the CLI in-process against srv with a fresh HOME.
func run(t *testing.T, srv *httptest.Server, terminal bool, stdin string, args ...string) result {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv(config.EnvServer, srv.URL)
	t.Setenv(config.EnvToken, "ch_pat_testtoken")
	for _, k := range []string{config.EnvConnection, config.EnvProfile, config.EnvOutput, config.EnvCACert, config.EnvInsecure} {
		t.Setenv(k, "")
	}
	return runHere(t, terminal, stdin, args...)
}

func runHere(t *testing.T, terminal bool, stdin string, args ...string) result {
	t.Helper()
	var out, errBuf bytes.Buffer
	code := Run(context.Background(), args, Streams{In: strings.NewReader(stdin), Out: &out, Err: &errBuf, InTTY: terminal, OutTTY: terminal}, "1.0.0-test", "c", "d")
	return result{out: out.String(), err: errBuf.String(), code: code}
}

func TestOutputIsATableOnATerminalAndJSONWhenPiped(t *testing.T) {
	srv, _ := fakeServer(t)
	table := run(t, srv, true, "", "table", "list")
	if table.code != 0 || !strings.Contains(table.out, "DATABASE") || !strings.Contains(table.out, "2.0 KiB") {
		t.Fatalf("terminal output must be a table: %+v", table)
	}
	piped := run(t, srv, false, "", "table", "list")
	var rows []map[string]any
	if err := json.Unmarshal([]byte(piped.out), &rows); err != nil || rows[0]["table"] != "orders" {
		t.Fatalf("piped output must be JSON: %v %q", err, piped.out)
	}
	csv := run(t, srv, true, "", "table", "list", "-o", "csv", "--no-headers")
	if !strings.HasPrefix(csv.out, "shop,orders,table,MergeTree") {
		t.Fatalf("csv: %q", csv.out)
	}
}

func TestConnectionByName(t *testing.T) {
	srv, rec := fakeServer(t)
	res := run(t, srv, false, "", "table", "list", "-c", "PROD")
	if res.code != 0 {
		t.Fatalf("name lookup failed: %+v", res)
	}
	last := rec.requests[len(rec.requests)-1]
	if last.URL.Path != "/api/explorer/databases" || last.Header.Get("X-Connection-Id") != prodID {
		t.Fatalf("want the connection id header, got %s %q", last.URL.Path, last.Header.Get("X-Connection-Id"))
	}
	unknown := run(t, srv, false, "", "table", "list", "-c", "nope")
	if unknown.code != api.ExitUsage || !strings.Contains(unknown.err, "prod, staging") {
		t.Fatalf("unknown name must list the choices: %+v", unknown)
	}
	byID := run(t, srv, false, "", "table", "list", "-c", prodID)
	if byID.code != 0 {
		t.Fatalf("ids pass through: %+v", byID)
	}
}

func TestQueryRendersRowsInResultOrderAndWritesFiles(t *testing.T) {
	srv, _ := fakeServer(t)
	res := run(t, srv, true, "", "query", "SELECT z, a FROM t")
	lines := strings.Split(strings.TrimSpace(res.out), "\n")
	if res.code != 0 || !strings.HasPrefix(lines[0], "Z") || !strings.Contains(lines[0], "A") || !strings.Contains(res.err, "1 row(s)") {
		t.Fatalf("query table: %+v", res)
	}
	out := filepath.Join(t.TempDir(), "result.csv")
	res = run(t, srv, false, "", "query", "SELECT z, a FROM t", "--out", out)
	raw, err := os.ReadFile(out)
	if res.code != 0 || err != nil || string(raw) != "z,a\n1,\"x,y\"\n" {
		t.Fatalf("--out csv: %+v %q %v", res, raw, err)
	}
}

func TestWritesAreGuarded(t *testing.T) {
	srv, rec := fakeServer(t)
	noRaw := run(t, srv, false, "", "query", "DELETE FROM t WHERE 1")
	if noRaw.code != api.ExitUsage || !strings.Contains(noRaw.err, "--raw") {
		t.Fatalf("writes need --raw: %+v", noRaw)
	}
	before := len(rec.paths())
	noYes := run(t, srv, false, "", "query", "--raw", "DELETE FROM t WHERE 1")
	if noYes.code != api.ExitUsage || len(rec.paths()) != before {
		t.Fatalf("no --yes without a terminal must refuse before any request: %+v %v", noYes, rec.paths())
	}
	dry := run(t, srv, false, "", "query", "--raw", "--dry-run", "ALTER TABLE t DELETE WHERE id = 2")
	if dry.code != 0 || !strings.Contains(dry.out, "rowsAffected") {
		t.Fatalf("dry run must estimate: %+v", dry)
	}
	prompted := run(t, srv, true, "no\n", "live", "kill", "q1")
	if prompted.code != api.ExitUsage || !strings.Contains(prompted.err, "aborted") {
		t.Fatalf("a typed no must abort: %+v", prompted)
	}
}

func TestErrorsMapToExitCodesWithHints(t *testing.T) {
	srv, _ := fakeServer(t)
	res := run(t, srv, false, "", "live", "list")
	if res.code != api.ExitRBAC || !strings.Contains(res.err, "request id: req-123") || !strings.Contains(res.err, "hint:") {
		t.Fatalf("403: %+v", res)
	}
	t.Setenv("HOME", t.TempDir())
	t.Setenv(config.EnvServer, "http://127.0.0.1:1")
	down := runHere(t, false, "", "table", "list", "--timeout", "2")
	if down.code != api.ExitNetwork {
		t.Fatalf("an unreachable server is exit 6: %+v", down)
	}
	usage := run(t, srv, false, "", "table", "list", "--nope")
	if usage.code != api.ExitUsage {
		t.Fatalf("bad flags are exit 2: %+v", usage)
	}
}

func TestInterruptedCommandsExit130(t *testing.T) {
	srv, _ := fakeServer(t)
	t.Setenv("HOME", t.TempDir())
	t.Setenv(config.EnvServer, srv.URL)
	t.Setenv(config.EnvToken, "ch_pat_testtoken")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var out, errBuf bytes.Buffer
	code := Run(ctx, []string{"table", "list"}, Streams{In: strings.NewReader(""), Out: &out, Err: &errBuf}, "t", "", "")
	if code != ExitInterrupted {
		t.Fatalf("want 130, got %d: %s", code, errBuf.String())
	}
}

func TestDebugTracesWithoutTheToken(t *testing.T) {
	srv, _ := fakeServer(t)
	res := run(t, srv, false, "", "table", "list", "--debug")
	if !strings.Contains(res.err, "debug: GET /api/explorer/databases -> 200") || strings.Contains(res.err, "ch_pat_testtoken") {
		t.Fatalf("debug trace: %q", res.err)
	}
}

func TestLoginKeepsTheTokenOffTheCommandLine(t *testing.T) {
	srv, _ := fakeServer(t)
	t.Setenv("HOME", t.TempDir())
	t.Setenv(config.EnvToken, "")
	t.Setenv(config.EnvServer, "")
	res := runHere(t, false, "ch_pat_fromstdin\n", "auth", "login", "--server", srv.URL, "--token-stdin")
	creds, _ := config.LoadCredentials()
	if res.code != 0 || creds.Tokens["default"] != "ch_pat_fromstdin" || strings.Contains(res.out+res.err, "ch_pat_fromstdin") {
		t.Fatalf("--token-stdin login: %+v %v", res, creds.Tokens)
	}
	if cfg, _ := config.LoadFile(); cfg.Profiles["default"].Server != srv.URL {
		t.Fatalf("login must remember the server: %+v", cfg)
	}
	noToken := runHere(t, false, "", "auth", "login", "--server", srv.URL)
	if noToken.code != api.ExitUsage || !strings.Contains(noToken.err, "--token-stdin") {
		t.Fatalf("no token and no terminal: %+v", noToken)
	}
	flag := runHere(t, false, "", "auth", "login", "--server", srv.URL, "--token", "ch_pat_onthecommandline")
	if flag.code != 0 || !strings.Contains(flag.err, "shell history") {
		t.Fatalf("--token must warn: %+v", flag)
	}
	notAPat := runHere(t, false, "eyJhbGci\n", "auth", "login", "--server", srv.URL, "--token-stdin")
	if notAPat.code != api.ExitUsage {
		t.Fatalf("a non-PAT must be refused: %+v", notAPat)
	}
}

func TestConfigProfiles(t *testing.T) {
	srv, _ := fakeServer(t)
	run(t, srv, false, "")
	steps := [][]string{
		{"config", "set", "server", "https://prod.example", "--profile", "prod"},
		{"config", "set", "connection", "prod", "--profile", "prod"},
		{"config", "use-profile", "prod"},
	}
	for _, step := range steps {
		if res := runHere(t, false, "", step...); res.code != 0 {
			t.Fatalf("%v: %+v", step, res)
		}
	}
	got := runHere(t, false, "", "config", "get", "connection")
	if strings.TrimSpace(got.out) != "prod" {
		t.Fatalf("config get: %+v", got)
	}
	if res := runHere(t, false, "", "config", "set", "output", "xml"); res.code != api.ExitUsage {
		t.Fatalf("invalid output must be refused: %+v", res)
	}
	if res := runHere(t, false, "", "config", "use-profile", "missing"); res.code != api.ExitUsage {
		t.Fatalf("unknown profile must be refused: %+v", res)
	}
	list := runHere(t, true, "", "config", "profiles")
	if !strings.Contains(list.out, "*") || !strings.Contains(list.out, "https://prod.example") {
		t.Fatalf("profiles: %q", list.out)
	}
}

func TestLogsValidatesLimit(t *testing.T) {
	srv, _ := fakeServer(t)
	if res := run(t, srv, false, "", "logs", "--limit", "500"); res.code != api.ExitUsage {
		t.Fatalf("--limit above 100: %+v", res)
	}
}

func TestUnknownSubcommandsFail(t *testing.T) {
	srv, _ := fakeServer(t)
	res := run(t, srv, false, "", "connection", "create")
	if res.code != api.ExitUsage || !strings.Contains(res.err, `unknown command "create"`) {
		t.Fatalf("a typo must not exit 0: %+v", res)
	}
	if help := run(t, srv, false, "", "connection"); help.code != 0 || !strings.Contains(help.out, "Available Commands") {
		t.Fatalf("a bare group prints help: %+v", help)
	}
}
