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
		default:
			writeOK(w, map[string]any{"dashboard": map[string]any{"id": "d1", "version": 7}, "panels": []any{}})
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
	doc := `{"format":"chouse.dashboard/v1","id":` + idJSON + `,"dashboard":{"title":"Orders","panels":[]}}`
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
		{"dashboard", "run-panel", "d1", "p1", "--range", "24h", "--var", "db=shop", "--var", "table=a=b", "-c", "prod"},
	} {
		if res := run(t, srv, false, "", args...); res.code != 0 {
			t.Fatalf("%v failed: %+v", args, res)
		}
	}
	got := calls()
	if len(got) != 3 || got[0].path != "/api/dashboards" || got[1].path != "/api/dashboards/d%2F1" || got[2].method != "POST" || got[2].path != "/api/dashboards/d1/panels/p1/run" {
		t.Fatalf("requests: %+v", got)
	}
	body, _ := json.Marshal(got[2].body)
	want := `{"range":{"kind":"relative","value":"24h"},"values":{"db":"shop","table":"a=b"}}`
	if string(body) != want {
		t.Fatalf("run body %s, want %s", body, want)
	}
	if got[2].connection != prodID {
		t.Fatalf("run-panel ran on %q, want the -c connection %q", got[2].connection, prodID)
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
	if got[0].body["format"] != "chouse.dashboard/v1" {
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
