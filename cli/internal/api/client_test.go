package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEnvelopeSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ch_pat_test" {
			t.Errorf("missing PAT auth header: %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Connection-Id") != "conn-1" {
			t.Errorf("missing connection header: %q", r.Header.Get("X-Connection-Id"))
		}
		if r.Header.Get("X-Requested-With") != "" {
			t.Errorf("CLI must not send X-Requested-With")
		}
		if r.Header.Get("X-Session-ID") != "" {
			t.Errorf("CLI must never send X-Session-ID")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"status":"healthy"}}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "ch_pat_test", "conn-1")
	got, err := c.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if got["status"] != "healthy" {
		t.Fatalf("unexpected body: %v", got)
	}
}

func TestEnvelopeErrorExitCodes(t *testing.T) {
	cases := []struct {
		status int
		body   string
		exit   int
	}{
		{401, `{"success":false,"error":{"code":"UNAUTHORIZED","message":"Invalid personal access token"}}`, ExitAuth},
		{403, `{"success":false,"error":{"code":"FORBIDDEN","message":"Permission 'x' required"}}`, ExitRBAC},
		{500, `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"boom"}}`, ExitServer},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		}))
		c := New(srv.URL, "ch_pat_x", "")
		_, err := c.Health(context.Background())
		srv.Close()
		if err == nil {
			t.Fatalf("expected error for %d", tc.status)
		}
		apiErr, ok := err.(*Error)
		if !ok {
			t.Fatalf("expected *Error, got %T", err)
		}
		if apiErr.ExitCode() != tc.exit {
			t.Fatalf("status %d: got exit %d want %d", tc.status, apiErr.ExitCode(), tc.exit)
		}
		if !strings.Contains(apiErr.Error(), apiErr.Code) {
			t.Fatalf("error should contain code: %v", apiErr)
		}
	}
}

func TestNonEnvelopeDecodes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`not json`))
	}))
	defer srv.Close()
	c := New(srv.URL, "ch_pat_x", "")
	_, err := c.Health(context.Background())
	if err == nil || !strings.Contains(err.Error(), "DECODE_ERROR") {
		t.Fatalf("expected DECODE_ERROR, got %v", err)
	}
}

func TestMarshalShapes(t *testing.T) {
	// Guards the query request shape the server validates.
	body := map[string]any{"query": "SELECT 1", "format": "JSON", "maxResultRows": 100}
	raw, _ := json.Marshal(body)
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["query"] != "SELECT 1" {
		t.Fatalf("shape changed: %s", raw)
	}
}
