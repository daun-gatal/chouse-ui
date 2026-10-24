package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// actionServer answers /api/ai-actions/run like the server does for a T2
// tool: 409 CONFIRMATION_REQUIRED until the body says confirmed. It records
// every run body it receives.
func actionServer(t *testing.T) (*httptest.Server, func() []map[string]any) {
	t.Helper()
	var mu sync.Mutex
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		switch {
		case r.URL.Path == "/api/ai-actions/run":
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			mu.Lock()
			bodies = append(bodies, body)
			mu.Unlock()
			if body["tool"] == "drop_table" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"submitted": true, "actionId": "a-3", "tier": "t3"}})
				return
			}
			if body["confirmed"] != true {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error": map[string]any{"code": "CONFIRMATION_REQUIRED", "message": "Confirm: Run a scheduled job now"}})
				return
			}
			writeOK(w, map[string]any{"done": true, "actionId": "a-2", "tier": "t2"})
		case r.URL.Path == "/api/ai-actions/tools":
			writeOK(w, map[string]any{"tools": []any{map[string]any{"name": "create_saved_query", "tier": "t1", "toolkit": "data", "title": "Save a query"}}})
		case r.URL.Path == "/api/ai-actions/activity":
			writeOK(w, map[string]any{"actions": []any{map[string]any{"id": "a-1", "tool": "create_saved_query", "limit": r.URL.Query().Get("limit")}}})
		default:
			writeOK(w, map[string]any{"id": "a-1", "status": "done"})
		}
	}))
	t.Cleanup(srv.Close)
	return srv, func() []map[string]any {
		mu.Lock()
		defer mu.Unlock()
		return append([]map[string]any(nil), bodies...)
	}
}

func TestParseActionArgs(t *testing.T) {
	got, err := parseActionArgs([]string{"name=orders", "limit=5", "tags=[\"a\"]", "query=SELECT 1"}, `{"connectionId":"c1","limit":1}`)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"connectionId": "c1", "name": "orders", "limit": float64(5), "tags": []any{"a"}, "query": "SELECT 1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
	if _, err := parseActionArgs([]string{"novalue"}, ""); err == nil {
		t.Fatal("a pair without = must be refused")
	}
	if _, err := parseActionArgs(nil, "[1]"); err == nil {
		t.Fatal("--args must be a JSON object")
	}
}

func TestActionRunConfirmsOnATerminal(t *testing.T) {
	srv, bodies := actionServer(t)
	res := run(t, srv, true, "yes\n", "action", "run", "run_scheduled_job_now", "id=j1")
	if res.code != 0 || !strings.Contains(res.err, "Run a scheduled job now") {
		t.Fatalf("terminal confirm: %+v", res)
	}
	got := bodies()
	if len(got) != 2 || got[0]["confirmed"] != false || got[1]["confirmed"] != true {
		t.Fatalf("run bodies: %v", got)
	}
}

func TestActionRunWithoutYesRefusesWhenPiped(t *testing.T) {
	srv, bodies := actionServer(t)
	res := run(t, srv, false, "", "action", "run", "run_scheduled_job_now", "id=j1")
	if res.code == 0 {
		t.Fatalf("piped T2 without --yes must fail: %+v", res)
	}
	if got := bodies(); len(got) != 1 {
		t.Fatalf("it must not resend unconfirmed: %v", got)
	}
}

func TestActionRunYesSendsConfirmed(t *testing.T) {
	srv, bodies := actionServer(t)
	res := run(t, srv, false, "", "action", "run", "run_scheduled_job_now", "id=j1", "--yes")
	if res.code != 0 {
		t.Fatalf("--yes: %+v", res)
	}
	got := bodies()
	if len(got) != 1 || got[0]["confirmed"] != true || got[0]["tool"] != "run_scheduled_job_now" {
		t.Fatalf("run bodies: %v", got)
	}
}

func TestActionRunReportsASecondApprover(t *testing.T) {
	srv, _ := actionServer(t)
	res := run(t, srv, false, "", "action", "run", "drop_table", "database=shop", "table=old", "--yes")
	if res.code != 0 || !strings.Contains(res.err, "second person") || !strings.Contains(res.err, "a-3") {
		t.Fatalf("T3: %+v", res)
	}
}

func TestActionReadsAndUndo(t *testing.T) {
	srv, _ := actionServer(t)
	tools := run(t, srv, true, "", "action", "tools")
	if tools.code != 0 || !strings.Contains(tools.out, "create_saved_query") || !strings.Contains(tools.out, "TIER") {
		t.Fatalf("tools: %+v", tools)
	}
	activity := run(t, srv, false, "", "action", "activity", "--limit", "7")
	if activity.code != 0 || !strings.Contains(activity.out, `"7"`) {
		t.Fatalf("activity: %+v", activity)
	}
	undo := run(t, srv, false, "", "action", "undo", "a-1")
	if undo.code == 0 {
		t.Fatalf("piped undo without --yes must fail: %+v", undo)
	}
	undo = run(t, srv, false, "", "action", "undo", "a-1", "--yes")
	if undo.code != 0 {
		t.Fatalf("undo --yes: %+v", undo)
	}
}
