package api

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// TLSOptions configures how the client trusts the server. Production
// installs often sit behind an internal CA; InsecureSkipVerify exists for
// break-glass debugging only and is never the default.
type TLSOptions struct {
	// CACertFile is a PEM bundle added to the system roots.
	CACertFile string
	// InsecureSkipVerify disables certificate verification.
	InsecureSkipVerify bool
}

// ConfigureTLS installs a transport honoring opts. It clones the default
// transport, so proxy settings (HTTPS_PROXY/NO_PROXY) keep working.
func (c *Client) ConfigureTLS(opts TLSOptions) error {
	if opts.CACertFile == "" && !opts.InsecureSkipVerify {
		return nil
	}
	base, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return errors.New("unexpected default HTTP transport")
	}
	transport := base.Clone()
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if opts.CACertFile != "" {
		pem, err := os.ReadFile(opts.CACertFile)
		if err != nil {
			return fmt.Errorf("read CA certificate: %w", err)
		}
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return fmt.Errorf("no PEM certificates found in %s", opts.CACertFile)
		}
		cfg.RootCAs = pool
	}
	if opts.InsecureSkipVerify {
		cfg.InsecureSkipVerify = true // #nosec G402 -- explicit operator opt-in for debugging
	}
	transport.TLSClientConfig = cfg
	c.HTTP.Transport = transport
	return nil
}

// RetryPolicy bounds retries of idempotent requests (GET/HEAD) on transient
// failures: network errors, 429 and 502/503/504. Writes are never retried —
// a lost response does not mean the write did not happen.
type RetryPolicy struct {
	Attempts  int
	BaseDelay time.Duration
	MaxDelay  time.Duration
}

// DefaultRetryPolicy rides out a rolling restart or a brief overload.
var DefaultRetryPolicy = RetryPolicy{Attempts: 3, BaseDelay: 500 * time.Millisecond, MaxDelay: 10 * time.Second}

func retryableStatus(status int) bool {
	switch status {
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	}
	return false
}

func idempotent(method string) bool {
	return method == http.MethodGet || method == http.MethodHead
}

// retryDelay honors Retry-After (seconds) when present, else backs off
// exponentially; both are capped by MaxDelay.
func (p RetryPolicy) retryDelay(attempt int, resp *http.Response) time.Duration {
	delay := p.BaseDelay << attempt
	if resp != nil {
		if secs, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && secs >= 0 {
			delay = time.Duration(secs) * time.Second
		}
	}
	if delay > p.MaxDelay {
		delay = p.MaxDelay
	}
	return delay
}

// do sends req, retrying idempotent requests per c.Retry. The caller owns
// the returned response body.
func (c *Client) do(req *http.Request) (*http.Response, error) {
	attempts := c.Retry.Attempts
	if attempts < 1 || !idempotent(req.Method) {
		attempts = 1
	}
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		resp, err := c.HTTP.Do(req.Clone(req.Context()))
		last := attempt == attempts-1
		switch {
		case err != nil:
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || last {
				return nil, err
			}
			lastErr = err
		case !retryableStatus(resp.StatusCode) || last:
			return resp, nil
		}
		delay := c.Retry.retryDelay(attempt, resp)
		if resp != nil {
			resp.Body.Close()
		}
		select {
		case <-req.Context().Done():
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, req.Context().Err()
		case <-time.After(delay):
		}
	}
	return nil, lastErr
}

// EnableDebug traces every request to w: method, path, status, duration and
// the server's request id. Headers and bodies are never printed, so tokens
// cannot leak into logs.
func (c *Client) EnableDebug(w io.Writer) {
	base := c.HTTP.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	c.HTTP.Transport = &debugTransport{base: base, w: w}
}

type debugTransport struct {
	base http.RoundTripper
	w    io.Writer
	mu   sync.Mutex
}

func (t *debugTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	start := time.Now()
	resp, err := t.base.RoundTrip(req)
	elapsed := time.Since(start).Round(time.Millisecond)
	t.mu.Lock()
	defer t.mu.Unlock()
	target := req.URL.Path
	if req.URL.RawQuery != "" {
		target += "?" + req.URL.RawQuery
	}
	if err != nil {
		fmt.Fprintf(t.w, "debug: %s %s -> error after %s: %v\n", req.Method, target, elapsed, err)
		return nil, err
	}
	fmt.Fprintf(t.w, "debug: %s %s -> %d in %s request-id=%s\n", req.Method, target, resp.StatusCode, elapsed, resp.Header.Get("X-Request-Id"))
	return resp, nil
}
