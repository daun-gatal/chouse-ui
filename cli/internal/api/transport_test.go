package api

import (
	"context"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func fastRetry() RetryPolicy {
	return RetryPolicy{Attempts: 3, BaseDelay: time.Millisecond, MaxDelay: 5 * time.Millisecond}
}

func TestRetriesIdempotentRequestsOnTransientStatus(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"data":{"status":"healthy"}}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "ch_pat_test", "")
	c.Retry = fastRetry()
	if _, err := c.Health(context.Background()); err != nil {
		t.Fatalf("Health after retries: %v", err)
	}
	if got := calls.Load(); got != 3 {
		t.Fatalf("want 3 attempts, got %d", got)
	}
}

func TestNeverRetriesWrites(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"UNAVAILABLE","message":"down"}}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "ch_pat_test", "")
	c.Retry = fastRetry()
	if _, err := c.Post(context.Background(), "/api/saved-queries", map[string]any{"name": "x"}); err == nil {
		t.Fatal("want an error")
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("a POST must be sent once, got %d attempts", got)
	}
}

func TestGivesUpAfterTheLastAttempt(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	c := New(srv.URL, "ch_pat_test", "")
	c.Retry = fastRetry()
	_, err := c.Health(context.Background())
	apiErr, ok := err.(*Error)
	if !ok || apiErr.StatusCode != http.StatusBadGateway {
		t.Fatalf("want the final 502, got %v", err)
	}
	if got := calls.Load(); got != 3 {
		t.Fatalf("want 3 attempts, got %d", got)
	}
}

func TestRetryDelayHonorsRetryAfterAndCap(t *testing.T) {
	p := RetryPolicy{Attempts: 3, BaseDelay: 100 * time.Millisecond, MaxDelay: 2 * time.Second}
	resp := &http.Response{Header: http.Header{"Retry-After": []string{"1"}}}
	if got := p.retryDelay(0, resp); got != time.Second {
		t.Errorf("Retry-After: want 1s, got %v", got)
	}
	resp.Header.Set("Retry-After", "60")
	if got := p.retryDelay(0, resp); got != 2*time.Second {
		t.Errorf("cap: want 2s, got %v", got)
	}
	if got := p.retryDelay(2, nil); got != 400*time.Millisecond {
		t.Errorf("backoff: want 400ms, got %v", got)
	}
}

func TestTrustsACustomCA(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{"status":"healthy"}}`))
	}))
	defer srv.Close()

	// Without the CA the self-signed server is refused.
	plain := New(srv.URL, "ch_pat_test", "")
	plain.Retry = RetryPolicy{Attempts: 1}
	if _, err := plain.Health(context.Background()); err == nil {
		t.Fatal("an unknown CA must be refused")
	}

	caFile := filepath.Join(t.TempDir(), "ca.pem")
	block := &pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw}
	if err := os.WriteFile(caFile, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	trusted := New(srv.URL, "ch_pat_test", "")
	if err := trusted.ConfigureTLS(TLSOptions{CACertFile: caFile}); err != nil {
		t.Fatalf("ConfigureTLS: %v", err)
	}
	if _, err := trusted.Health(context.Background()); err != nil {
		t.Fatalf("with the CA: %v", err)
	}
}

func TestRejectsAFileWithoutCertificates(t *testing.T) {
	caFile := filepath.Join(t.TempDir(), "empty.pem")
	if err := os.WriteFile(caFile, []byte("not a cert"), 0o600); err != nil {
		t.Fatal(err)
	}
	c := New("https://x", "", "")
	if err := c.ConfigureTLS(TLSOptions{CACertFile: caFile}); err == nil {
		t.Fatal("want an error for a file with no PEM certificates")
	}
}
