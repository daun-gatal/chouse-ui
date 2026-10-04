package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMCPToolsParsesAnSSEResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mcp" || r.Method != http.MethodPost {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer ch_pat_test" || r.Header.Get("X-Connection-Id") != "conn-1" {
			t.Errorf("missing auth or connection headers")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["method"] != "tools/list" {
			t.Errorf("want tools/list, got %v", body["method"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"query\",\"title\":\"Run a read-only query\",\"description\":\"d\",\"annotations\":{\"readOnlyHint\":true}}]}}\n\n"))
	}))
	defer srv.Close()

	c := New(srv.URL, "ch_pat_test", "conn-1")
	tools, err := c.MCPTools(context.Background())
	if err != nil {
		t.Fatalf("MCPTools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "query" || !tools[0].Annotations.ReadOnlyHint {
		t.Fatalf("unexpected tools: %+v", tools)
	}
	if c.MCPEndpoint() != srv.URL+"/mcp" {
		t.Errorf("endpoint: %s", c.MCPEndpoint())
	}
}

func TestMCPCallSurfacesTheDisabledEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"MCP_DISABLED","message":"The MCP endpoint is turned off."}}`))
	}))
	defer srv.Close()

	_, err := New(srv.URL, "ch_pat_test", "").MCPTools(context.Background())
	apiErr, ok := err.(*Error)
	if !ok || apiErr.Code != "MCP_DISABLED" || apiErr.ExitCode() != ExitUsage {
		t.Fatalf("want MCP_DISABLED (exit 2), got %v", err)
	}
}

func TestMCPCallSurfacesJSONRPCErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}`))
	}))
	defer srv.Close()

	_, err := New(srv.URL, "ch_pat_test", "").MCPCall(context.Background(), "nope", nil)
	apiErr, ok := err.(*Error)
	if !ok || apiErr.Code != "MCP_-32601" || apiErr.Message != "Method not found" {
		t.Fatalf("want the JSON-RPC error, got %v", err)
	}
}
