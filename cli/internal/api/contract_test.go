package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// TestAllMethods exercises every client method against a contract stub that
// asserts transport rules and echoes the request for shape checks.
func TestAllMethods(t *testing.T) {
	var last struct {
		method string
		path   string
		body   map[string]any
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		last.method, last.path = r.Method, r.URL.Path
		if r.Header.Get("Authorization") != "Bearer ch_pat_contract" {
			t.Errorf("missing PAT auth on %s %s", r.Method, r.URL.Path)
		}
		if r.URL.Path == "/api/upload/preview" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{"columns":["a"]}}`))
			return
		}
		if r.URL.Path == "/api/rbac/audit/export" {
			w.Header().Set("Content-Type", "text/csv")
			_, _ = w.Write([]byte("id,action\na,b\n"))
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		last.body = body
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"ok": true, "path": r.URL.Path}})
	}))
	defer srv.Close()

	c := New(srv.URL, "ch_pat_contract", "conn-9")
	ctx := context.Background()

	if _, err := c.AppConfig(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Validate(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ConnectionsList(ctx, "x", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ConnectionTest(ctx, map[string]any{"host": "h"}); err != nil {
		t.Fatal(err)
	}
	if last.path != "/api/rbac/connections/test" || last.method != http.MethodPost {
		t.Fatalf("connection test routing wrong: %+v", last)
	}
	if _, err := c.ConnectionUse(ctx, "abc"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.CanAccess(ctx, map[string]any{"database": "d"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.QueryExecute(ctx, "SELECT 1", "JSON", 10); err != nil {
		t.Fatal(err)
	}
	if last.body["maxResultRows"] != float64(10) {
		t.Fatalf("query shape wrong: %v", last.body)
	}
	if _, err := c.QueryExplain(ctx, "SELECT 1", "plan"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.QueryTableSelect(ctx, "SELECT 1", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := c.QueryShow(ctx, "SHOW TABLES"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.DDLSimulate(ctx, "ALTER TABLE t UPDATE x=1 WHERE y=2"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ExplorerDatabases(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ExplorerTable(ctx, "db", "t"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ExplorerSample(ctx, "db", "t", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(ctx, "/api/fleet/snapshots", url.Values{"limit": {"3"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Post(ctx, "/api/ai/invoke", map[string]any{"capability": "optimize-query"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Put(ctx, "/api/saved-queries/1", map[string]any{"name": "n"}); err != nil {
		t.Fatal(err)
	}
	if last.method != http.MethodPut {
		t.Fatalf("PUT routing wrong: %+v", last)
	}
	if _, err := c.Delete(ctx, "/api/saved-queries/1"); err != nil {
		t.Fatal(err)
	}
	if last.method != http.MethodDelete {
		t.Fatalf("DELETE routing wrong: %+v", last)
	}

	// Upload preview with a real temp file.
	f := filepath.Join(t.TempDir(), "rows.csv")
	if err := os.WriteFile(f, []byte("a\n1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := c.UploadPreview(ctx, f, "CSV", true); err != nil {
		t.Fatal(err)
	}

	// Raw export returns bytes + content type.
	raw, ctype, err := c.GetRaw(ctx, "/api/rbac/audit/export", url.Values{})
	if err != nil || len(raw) == 0 || ctype != "text/csv" {
		t.Fatalf("export broken: %v %q %v", raw, ctype, err)
	}
}
