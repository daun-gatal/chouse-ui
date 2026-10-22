package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type dashboardCall struct {
	method, path, connection string
	body                     map[string]any
}

// dashboardServer answers the dashboards routes and records each call.
func dashboardServer(t *testing.T) (*httptest.Server, func() []dashboardCall) {
	t.Helper()
	var mu sync.Mutex
	var calls []dashboardCall
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		if r.URL.Path != "/api/rbac/connections/my" {
			mu.Lock()
			calls = append(calls, dashboardCall{r.Method, r.URL.EscapedPath(), r.Header.Get("X-Connection-Id"), body})
			mu.Unlock()
		}
		switch {
		case r.URL.Path == "/api/rbac/connections/my":
			writeOK(w, []any{map[string]any{"id": prodID, "name": "prod"}})
		case r.URL.Path == "/api/dashboards" && r.Method == "GET":
			writeOK(w, []any{
				map[string]any{"id": "d1", "title": "Orders", "panelCount": 2, "scope": map[string]any{"kind": "only", "connections": []any{map[string]any{"id": prodID, "name": "prod"}}, "hidden": 1}},
				map[string]any{"id": "d2", "title": "Overview", "panelCount": 8, "scope": map[string]any{"kind": "any"}},
			})
		case r.URL.Path == "/api/dashboards/d1/export":
			writeOK(w, map[string]any{"format": "chouse.dashboard/v1", "id": "d1", "dashboard": map[string]any{"title": "Orders"}})
		case strings.HasSuffix(r.URL.Path, "/run"):
			writeOK(w, map[string]any{"kind": "single", "data": map[string]any{"rows": []any{map[string]any{"v": 1}}}})
		case strings.HasSuffix(r.URL.Path, "/versions"):
			writeOK(w, []any{map[string]any{"version": 7, "source": "ui", "savedByName": "ada", "savedAt": 2}, map[string]any{"version": 6, "source": "restore", "savedByName": nil, "savedAt": 1}})
		case strings.HasSuffix(r.URL.Path, "/restore-preview"):
			writeOK(w, map[string]any{"removedPanels": 1, "removedAlerts": []any{map[string]any{"id": "a1", "name": "Slow inserts"}}})
		case strings.HasSuffix(r.URL.Path, "/snapshots") && r.Method == "GET":
			writeOK(w, []any{map[string]any{"id": "s1", "name": "Incident 42", "range": map[string]any{"from": 1, "to": 2}, "sizeBytes": 2048}})
		case r.URL.Path == "/api/dashboards/import/grafana":
			writeOK(w, map[string]any{
				"dashboard": map[string]any{"title": "From Grafana", "panels": []any{map[string]any{"kind": "chart"}}},
				"panels":    []any{map[string]any{"title": "Orders", "grafanaType": "timeseries", "status": "changed", "changes": []any{"$__timeFilter(ts) became ts >= {{from}} AND ts < {{to}}"}, "reason": nil}, map[string]any{"title": "Up", "grafanaType": "stat", "status": "skipped", "changes": []any{}, "reason": "it reads another data source"}},
				"variables": []any{},
				"notes":     []any{"Panels that overlapped (from collapsed rows) were moved down"},
			})
		default:
			writeOK(w, map[string]any{
				"dashboard": map[string]any{"id": "d1", "version": 7, "variables": []any{map[string]any{"name": "db", "kind": "string"}, map[string]any{"name": "table", "kind": "identifier"}, map[string]any{"name": "status", "kind": "multi"}}},
				"panels":    []any{map[string]any{"id": "p1", "kind": "chart", "title": "Orders", "viz": map[string]any{"type": "line", "unit": "count"}, "layout": map[string]any{"x": 0, "y": 0, "w": 12, "h": 9}, "fleet": false}},
			})
		}
	}))
	t.Cleanup(srv.Close)
	return srv, func() []dashboardCall {
		mu.Lock()
		defer mu.Unlock()
		return append([]dashboardCall(nil), calls...)
	}
}

func writeExport(t *testing.T, id string) string {
	t.Helper()
	idJSON := "null"
	if id != "" {
		idJSON = `"` + id + `"`
	}
	file := filepath.Join(t.TempDir(), "dash.json")
	doc := `{"format":"chouse.dashboard/v2","id":` + idJSON + `,"dashboard":{"title":"Orders","panels":[]}}`
	if err := os.WriteFile(file, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestDashboardReadsAndRunPanel(t *testing.T) {
	srv, calls := dashboardServer(t)
	for _, args := range [][]string{
		{"dashboard", "list"},
		{"dashboard", "get", "d/1"},
		{"dashboard", "run-panel", "d1", "p1", "--range", "24h", "--var", "db=shop", "--var", "table=a=b", "--var", "status=ok", "--var", "status=err", "-c", "prod"},
	} {
		if res := run(t, srv, false, "", args...); res.code != 0 {
			t.Fatalf("%v failed: %+v", args, res)
		}
	}
	got := calls()
	// run-panel reads the dashboard's variables first, to send a multi-value variable as a list.
	if len(got) != 4 || got[0].path != "/api/dashboards" || got[1].path != "/api/dashboards/d%2F1" || got[2].path != "/api/dashboards/d1" || got[3].method != "POST" || got[3].path != "/api/dashboards/d1/panels/p1/run" {
		t.Fatalf("requests: %+v", got)
	}
	body, _ := json.Marshal(got[3].body)
	want := `{"range":{"kind":"relative","value":"24h"},"values":{"db":"shop","status":["ok","err"],"table":"a=b"}}`
	if string(body) != want {
		t.Fatalf("run body %s, want %s", body, want)
	}
	if got[3].connection != prodID {
		t.Fatalf("run-panel ran on %q, want the -c connection %q", got[3].connection, prodID)
	}
}

func TestDashboardApplyImportsOrUpdatesAtTheCurrentVersion(t *testing.T) {
	srv, calls := dashboardServer(t)
	if res := run(t, srv, false, "", "dashboard", "apply", "-f", writeExport(t, "")); res.code != 0 {
		t.Fatalf("apply new: %+v", res)
	}
	if res := run(t, srv, false, "", "dashboard", "apply", "-f", writeExport(t, "d1")); res.code != 0 {
		t.Fatalf("apply existing: %+v", res)
	}
	got := calls()
	if len(got) != 3 || got[0].method+" "+got[0].path != "POST /api/dashboards/import" || got[1].method+" "+got[1].path != "GET /api/dashboards/d1" || got[2].method+" "+got[2].path != "PUT /api/dashboards/d1" {
		t.Fatalf("requests: %+v", got)
	}
	if got[0].body["format"] != "chouse.dashboard/v2" {
		t.Fatalf("import body: %+v", got[0].body)
	}
	if got[2].body["version"] != float64(7) || got[2].body["dashboard"].(map[string]any)["title"] != "Orders" {
		t.Fatalf("update body: %+v", got[2].body)
	}
}

func TestDashboardRejectsBadInputBeforeAnyRequest(t *testing.T) {
	srv, calls := dashboardServer(t)
	bad := filepath.Join(t.TempDir(), "bad.json")
	_ = os.WriteFile(bad, []byte(`{"format":"grafana","dashboard":{}}`), 0o600)
	for _, args := range [][]string{
		{"dashboard", "apply", "-f", bad},
		{"dashboard", "apply"},
		{"dashboard", "run-panel", "d1", "p1", "--range", "5h"},
		{"dashboard", "run-panel", "d1", "p1", "--var", "novalue"},
		{"dashboard", "delete", "d1"},
		{"dashboard", "restore", "d1", "zero"},
		{"dashboard", "snapshot", "create", "d1", "-c", prodID},
		{"dashboard", "snapshot", "create", "d1", "--name", "x"},
		{"dashboard", "snapshot", "create", "d1", "--name", "x", "--range", "5h", "-c", prodID},
		{"dashboard", "import-grafana"},
		{"dashboard", "import-grafana", "-f", bad},
	} {
		if res := run(t, srv, false, "", args...); res.code == 0 {
			t.Errorf("%v should fail: %+v", args, res)
		}
	}
	if got := calls(); len(got) != 0 {
		t.Fatalf("no request expected, got %+v", got)
	}
	if res := run(t, srv, false, "", "dashboard", "delete", "d1", "--yes"); res.code != 0 {
		t.Fatalf("delete --yes: %+v", res)
	}
	if got := calls(); len(got) != 1 || got[0].method != "DELETE" || got[0].path != "/api/dashboards/d1" {
		t.Fatalf("delete requests: %+v", got)
	}
}

func TestDashboardExportWritesPrettyJSON(t *testing.T) {
	srv, _ := dashboardServer(t)
	res := run(t, srv, false, "", "dashboard", "export", "d1")
	if res.code != 0 || !strings.Contains(res.out, "\"format\": \"chouse.dashboard/v1\"") {
		t.Fatalf("export stdout: %+v", res)
	}
	file := filepath.Join(t.TempDir(), "out.json")
	if res := run(t, srv, false, "", "dashboard", "export", "d1", "--out", file); res.code != 0 {
		t.Fatalf("export --out: %+v", res)
	}
	raw, err := os.ReadFile(file)
	if err != nil || !strings.Contains(string(raw), "\"id\": \"d1\"") {
		t.Fatalf("export file: %v %s", err, raw)
	}
}

func TestDashboardListShowsAssignedConnections(t *testing.T) {
	srv, _ := dashboardServer(t)
	res := run(t, srv, false, "", "dashboard", "list", "-o", "table")
	if res.code != 0 {
		t.Fatalf("list failed: %+v", res)
	}
	for _, want := range []string{"CONNECTIONS", "prod, +1 more", "all"} {
		if !strings.Contains(res.out, want) {
			t.Fatalf("list output missing %q:\n%s", want, res.out)
		}
	}
}

func TestDashboardRunPanelChecksVariables(t *testing.T) {
	srv, calls := dashboardServer(t)
	for _, args := range [][]string{
		{"dashboard", "run-panel", "d1", "p1", "--var", "nope=1"},
		{"dashboard", "run-panel", "d1", "p1", "--var", "db=a", "--var", "db=b"},
	} {
		if res := run(t, srv, false, "", args...); res.code == 0 {
			t.Errorf("%v should fail: %+v", args, res)
		}
	}
	for _, c := range calls() {
		if c.method == "POST" {
			t.Fatalf("no panel should run: %+v", c)
		}
	}
}

func TestDashboardAcceptsAFormat1Export(t *testing.T) {
	srv, calls := dashboardServer(t)
	file := filepath.Join(t.TempDir(), "old.json")
	_ = os.WriteFile(file, []byte(`{"format":"chouse.dashboard/v1","id":null,"dashboard":{"title":"Old","panels":[]}}`), 0o600)
	if res := run(t, srv, false, "", "dashboard", "apply", "-f", file); res.code != 0 {
		t.Fatalf("apply v1: %+v", res)
	}
	if got := calls(); len(got) != 1 || got[0].body["format"] != "chouse.dashboard/v1" {
		t.Fatalf("requests: %+v", got)
	}
}

func TestDashboardGetShowsKindAndSize(t *testing.T) {
	srv, _ := dashboardServer(t)
	res := run(t, srv, false, "", "dashboard", "get", "d1", "-o", "table")
	if res.code != 0 {
		t.Fatalf("get failed: %+v", res)
	}
	for _, want := range []string{"KIND", "SIZE", "chart", "12x9"} {
		if !strings.Contains(res.out, want) {
			t.Fatalf("get output missing %q:\n%s", want, res.out)
		}
	}
}

func TestDashboardVersionsAndRestore(t *testing.T) {
	srv, calls := dashboardServer(t)
	res := run(t, srv, false, "", "dashboard", "versions", "d1", "-o", "table")
	if res.code != 0 || !strings.Contains(res.out, "restore") || !strings.Contains(res.out, "ada") {
		t.Fatalf("versions: %+v", res)
	}
	res = run(t, srv, false, "", "dashboard", "restore", "d1", "6", "--yes")
	if res.code != 0 || !strings.Contains(res.err, "Slow inserts") {
		t.Fatalf("restore: %+v", res)
	}
	got := calls()
	last := got[len(got)-1]
	if last.method+" "+last.path != "POST /api/dashboards/d1/versions/6/restore" || last.body["currentVersion"] != float64(7) {
		t.Fatalf("restore request: %+v", last)
	}
}

func TestDashboardSnapshots(t *testing.T) {
	srv, calls := dashboardServer(t)
	res := run(t, srv, false, "", "dashboard", "snapshot", "create", "d1", "--name", "Incident 42", "--range", "6h", "--role", "r1", "--expires-days", "90", "--var", "status=ok", "-c", "prod")
	if res.code != 0 {
		t.Fatalf("snapshot create: %+v", res)
	}
	var create dashboardCall
	for _, c := range calls() {
		if c.method == "POST" {
			create = c
		}
	}
	if create.path != "/api/dashboards/d1/snapshots" || create.connection != prodID {
		t.Fatalf("snapshot request: %+v", create)
	}
	from, _ := create.body["from"].(float64)
	to, _ := create.body["to"].(float64)
	if to-from != 21600 || create.body["name"] != "Incident 42" || create.body["expiresInDays"] != float64(90) {
		t.Fatalf("snapshot body: %+v", create.body)
	}
	if roles, _ := create.body["roleIds"].([]any); len(roles) != 1 || roles[0] != "r1" {
		t.Fatalf("snapshot roles: %+v", create.body)
	}
	if values, _ := create.body["values"].(map[string]any); values["status"] == nil {
		t.Fatalf("snapshot values: %+v", create.body)
	}
	res = run(t, srv, false, "", "dashboard", "snapshot", "list", "d1", "-o", "table")
	if res.code != 0 || !strings.Contains(res.out, "Incident 42") {
		t.Fatalf("snapshot list: %+v", res)
	}
}

func TestDashboardImportGrafana(t *testing.T) {
	srv, calls := dashboardServer(t)
	file := filepath.Join(t.TempDir(), "grafana.json")
	_ = os.WriteFile(file, []byte(`{"schemaVersion":39,"panels":[]}`), 0o600)
	res := run(t, srv, false, "", "dashboard", "import-grafana", "-f", file, "-c", "prod", "-o", "table")
	if res.code != 0 || !strings.Contains(res.out, "skipped") || !strings.Contains(res.out, "it reads another data source") || !strings.Contains(res.err, "moved down") {
		t.Fatalf("preview: %+v", res)
	}
	got := calls()
	if len(got) != 1 || got[0].path != "/api/dashboards/import/grafana" {
		t.Fatalf("preview must not import: %+v", got)
	}
	scope, _ := got[0].body["connectionScope"].(map[string]any)
	if ids, _ := scope["connectionIds"].([]any); scope["kind"] != "only" || len(ids) != 1 || ids[0] != prodID {
		t.Fatalf("scope: %+v", got[0].body)
	}
	if res := run(t, srv, false, "", "dashboard", "import-grafana", "-f", file, "--all-connections", "--apply"); res.code != 0 {
		t.Fatalf("apply: %+v", res)
	}
	got = calls()
	last := got[len(got)-1]
	if last.path != "/api/dashboards/import" || last.body["format"] != "chouse.dashboard/v2" || last.body["dashboard"].(map[string]any)["title"] != "From Grafana" {
		t.Fatalf("import request: %+v", last)
	}
	if scope, _ := got[len(got)-2].body["connectionScope"].(map[string]any); scope["kind"] != "any" {
		t.Fatalf("--all-connections scope: %+v", got[len(got)-2].body)
	}
}
