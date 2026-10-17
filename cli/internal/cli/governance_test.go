package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
)

// governanceServer answers every route with a small payload and records the
// path, query and connection header of each request.
func governanceServer(t *testing.T) (*httptest.Server, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		mu.Lock()
		entry := r.URL.EscapedPath()
		if r.URL.RawQuery != "" {
			entry += "?" + r.URL.RawQuery
		}
		if conn := r.Header.Get("X-Connection-Id"); conn != "" {
			entry += " [" + conn + "]"
		}
		seen = append(seen, entry)
		mu.Unlock()
		switch {
		case r.URL.Path == "/api/rbac/connections/my":
			writeOK(w, []any{map[string]any{"id": prodID, "name": "prod"}})
		case r.URL.Path == "/api/notebooks/attached/incident_observe/inc-1":
			writeOK(w, map[string]any{"notebook": map[string]any{"id": "nb 1"}, "cells": []any{map[string]any{"position": 0, "kind": "note"}}})
		case r.URL.Path == "/api/notebooks/nb 1/export":
			w.Header().Set("Content-Type", "text/markdown")
			_, _ = w.Write([]byte("# Postmortem\n"))
		case r.URL.Path == "/api/context/metrics":
			writeOK(w, map[string]any{"metrics": []any{map[string]any{"name": "gmv"}, map[string]any{"name": "orders"}}})
		default:
			writeOK(w, map[string]any{"rows": []any{}})
		}
	}))
	t.Cleanup(srv.Close)
	return srv, func() []string {
		mu.Lock()
		defer mu.Unlock()
		out := make([]string, 0, len(seen))
		for _, s := range seen {
			if !strings.HasPrefix(s, "/api/rbac/connections/my") {
				out = append(out, s)
			}
		}
		return out
	}
}

func writeOK(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
}

func TestGovernanceReadsProjectOntoTheAPI(t *testing.T) {
	srv, seen := governanceServer(t)
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"ai", "usage", "--days", "30"}, "/api/ai-usage/summary?days=30"},
		{[]string{"ai", "usage", "--by", "origin"}, "/api/ai-usage/summary?days=7"},
		{[]string{"ai", "usage", "--by", "model"}, "/api/ai-usage/models?days=7"},
		{[]string{"ai", "egress", "--search", "customers"}, "/api/ai-usage/egress?days=7&q=customers"},
		{[]string{"ai", "requests", "--origin", "mcp", "--limit", "20", "--offset", "40"}, "/api/ai-usage/requests?days=7&limit=20&offset=40&origin=mcp"},
		{[]string{"ai", "request", "req/1"}, "/api/ai-usage/requests/req%2F1"},
		{[]string{"ai", "agents"}, "/api/ai-agents/registry"},
		{[]string{"ai", "guardrails"}, "/api/ai-guardrails"},
		{[]string{"ai", "guardrail-triggers", "--guardrail", "builtin-guardrail-pii", "--days", "3", "--limit", "20"}, "/api/ai-guardrails/events?days=3&guardrailId=builtin-guardrail-pii&limit=20&offset=0"},
		{[]string{"ai", "guardrail-triggers", "--limit", "50", "--offset", "100"}, "/api/ai-guardrails/events?days=7&limit=50&offset=100"},
		{[]string{"perf", "regressions", "-c", "prod"}, "/api/observe/performance?connectionId=" + prodID + " [" + prodID + "]"},
		{[]string{"perf", "shape", "ab12", "-c", "prod"}, "/api/observe/performance/fingerprints/ab12?connectionId=" + prodID + " [" + prodID + "]"},
		{[]string{"capacity", "-c", "prod", "--view", "growth"}, "/api/observe/capacity?connectionId=" + prodID + " [" + prodID + "]"},
		{[]string{"upgrades", "list", "-c", "prod"}, "/api/upgrades/assessments?connectionId=" + prodID + " [" + prodID + "]"},
		{[]string{"upgrades", "get", "as-1"}, "/api/upgrades/assessments/as-1"},
		{[]string{"upgrades", "replay", "rp-1"}, "/api/upgrades/replays/rp-1"},
		{[]string{"upgrades", "rollout"}, "/api/upgrades/rollout"},
		{[]string{"collectors", "status", "-c", "prod"}, "/api/observe/status?connectionId=" + prodID + " [" + prodID + "]"},
		{[]string{"collectors", "schedule"}, "/api/observe/collectors/schedule"},
		{[]string{"collectors", "schedule", "-c", "prod"}, "/api/observe/collectors/schedule/" + prodID + " [" + prodID + "]"},
		{[]string{"context", "get", "shop.orders", "-c", "prod"}, "/api/context/tables/shop/orders?connectionId=" + prodID + " [" + prodID + "]"},
		{[]string{"context", "metrics", "-c", "prod"}, "/api/context/metrics?connectionId=" + prodID + " [" + prodID + "]"},
		{[]string{"notebook", "show", "observe", "inc-1"}, "/api/notebooks/attached/incident_observe/inc-1"},
	}
	for _, c := range cases {
		before := len(seen())
		res := run(t, srv, false, "", c.args...)
		if res.code != 0 {
			t.Fatalf("%v failed: %+v", c.args, res)
		}
		got := seen()[before:]
		if len(got) != 1 || got[0] != c.want {
			t.Errorf("%v requested %v, want [%s]", c.args, got, c.want)
		}
	}
}

func TestNotebookExportWritesMarkdown(t *testing.T) {
	srv, seen := governanceServer(t)
	res := run(t, srv, false, "", "notebook", "export", "observe", "inc-1")
	if res.code != 0 || res.out != "# Postmortem\n" {
		t.Fatalf("export: %+v", res)
	}
	got := seen()
	if len(got) != 2 || got[0] != "/api/notebooks/attached/incident_observe/inc-1" || got[1] != "/api/notebooks/nb%201/export" {
		t.Fatalf("export requests: %v", got)
	}
}

func TestContextMetricsFiltersByName(t *testing.T) {
	srv, _ := governanceServer(t)
	res := run(t, srv, false, "", "context", "metrics", "gmv", "-c", "prod")
	var payload struct {
		Metrics []map[string]any `json:"metrics"`
	}
	if res.code != 0 || json.Unmarshal([]byte(res.out), &payload) != nil || len(payload.Metrics) != 1 || payload.Metrics[0]["name"] != "gmv" {
		t.Fatalf("metrics gmv: %+v", res)
	}
}

func TestGovernanceReadsRejectBadInputBeforeAnyRequest(t *testing.T) {
	srv, seen := governanceServer(t)
	for _, args := range [][]string{
		{"ai", "usage", "--by", "user"},
		{"ai", "usage", "--days", "0"},
		{"ai", "requests", "--origin", "browser"},
		{"ai", "requests", "--limit", "500"},
		{"ai", "requests", "--offset", "-1"},
		{"ai", "guardrail-triggers", "--limit", "0"},
		{"ai", "guardrail-triggers", "--days", "0"},
		{"ai", "guardrail-triggers", "--offset", "-1"},
		{"capacity", "-c", "prod", "--view", "everything"},
		{"perf", "regressions"},
		{"capacity"},
		{"upgrades", "list"},
		{"collectors", "status"},
		{"context", "get", "shop.orders"},
		{"context", "get", "orders", "-c", "prod"},
		{"notebook", "show", "incident", "inc-1"},
	} {
		res := run(t, srv, false, "", args...)
		if res.code != api.ExitUsage {
			t.Errorf("%v: want a usage error, got %+v", args, res)
		}
	}
	if got := seen(); len(got) != 0 {
		t.Fatalf("bad input must not reach the server: %v", got)
	}
}

func TestGovernanceCommandsAreReadOnly(t *testing.T) {
	root := NewRoot("test", "", "")
	for _, parent := range [][]string{{"perf"}, {"upgrades"}, {"collectors"}, {"context"}, {"notebook"}} {
		cmd, _, err := root.Find(parent)
		if err != nil || cmd.Name() != parent[0] {
			t.Fatalf("missing command %v", parent)
		}
		for _, sub := range cmd.Commands() {
			for _, verb := range []string{"set", "run", "start", "delete", "edit", "pause", "resume", "create", "add"} {
				if sub.Name() == verb || strings.HasPrefix(sub.Name(), verb+"-") {
					t.Errorf("%s %s looks like a write; these settings are UI-only", parent[0], sub.Name())
				}
			}
		}
	}
}
