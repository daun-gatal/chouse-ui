// Package api is a typed PAT-authenticated HTTP client for the CHouse UI
// backend. It speaks the {success,data,error} envelope, sends
// Authorization: Bearer ch_pat_… with optional X-Connection-Id, and never
// sends X-Requested-With or legacy X-Session-ID.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Exit codes for agentic use.
const (
	ExitOK      = 0
	ExitUsage   = 2
	ExitAuth    = 3
	ExitRBAC    = 4
	ExitServer  = 5
	ExitNetwork = 6
)

// Error is a decoded server-side failure with HTTP status preserved.
type Error struct {
	StatusCode int
	Code       string
	Message    string
	RequestID  string
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s: %s (http %d)", e.Code, e.Message, e.StatusCode)
	}
	return fmt.Sprintf("http %d: %s", e.StatusCode, e.Message)
}

// ExitCode maps an API error to the CLI machine contract.
func (e *Error) ExitCode() int {
	switch e.StatusCode {
	case http.StatusUnauthorized:
		return ExitAuth
	case http.StatusForbidden:
		return ExitRBAC
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict:
		return ExitUsage
	default:
		if e.StatusCode >= 500 {
			return ExitServer
		}
		return ExitServer
	}
}

type envelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		ID      string `json:"id"`
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Client talks to one CHouse UI server as one profile.
type Client struct {
	BaseURL      string
	Token        string
	ConnectionID string
	HTTP         *http.Client
	UserAgent    string
}

// New builds a client with a bounded timeout.
func New(baseURL, token, connectionID string) *Client {
	return &Client{
		BaseURL:      strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		Token:        strings.TrimSpace(token),
		ConnectionID: strings.TrimSpace(connectionID),
		HTTP:         &http.Client{Timeout: 60 * time.Second},
		UserAgent:    "chouse-cli/1",
	}
}

func (c *Client) newRequest(ctx context.Context, method, path string, query url.Values, body any) (*http.Request, error) {
	u := c.BaseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if c.ConnectionID != "" {
		req.Header.Set("X-Connection-Id", c.ConnectionID)
	}
	if c.UserAgent != "" {
		req.Header.Set("User-Agent", c.UserAgent)
	}
	// Deliberately no X-Requested-With (PAT is exempt) and no X-Session-ID.
	return req, nil
}

// DoJSON decodes the envelope into out (out may be nil for message-only).
func (c *Client) DoJSON(ctx context.Context, method, path string, query url.Values, body any, out any) error {
	req, err := c.newRequest(ctx, method, path, query, body)
	if err != nil {
		return err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return &Error{Code: "NETWORK_ERROR", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return &Error{StatusCode: resp.StatusCode, Code: "READ_ERROR", Message: err.Error()}
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return &Error{StatusCode: resp.StatusCode, Code: "DECODE_ERROR", Message: fmt.Sprintf("non-envelope response: %s", truncate(string(raw), 300))}
	}
	if !env.Success {
		code, msg, id := "REQUEST_FAILED", "request failed", ""
		if env.Error != nil {
			code, msg, id = env.Error.Code, env.Error.Message, env.Error.ID
		}
		return &Error{StatusCode: resp.StatusCode, Code: code, Message: msg, RequestID: id}
	}
	if out != nil && len(env.Data) > 0 && string(env.Data) != "null" {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return &Error{StatusCode: resp.StatusCode, Code: "DECODE_ERROR", Message: err.Error()}
		}
	}
	return nil
}

// GetRaw performs a GET returning raw bytes (CSV export, NDJSON stream head).
func (c *Client) GetRaw(ctx context.Context, path string, query url.Values) ([]byte, string, error) {
	req, err := c.newRequest(ctx, http.MethodGet, path, query, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, "", &Error{Code: "NETWORK_ERROR", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode >= 400 {
		var env envelope
		if json.Unmarshal(raw, &env) == nil && !env.Success && env.Error != nil {
			return nil, "", &Error{StatusCode: resp.StatusCode, Code: env.Error.Code, Message: env.Error.Message}
		}
		return nil, "", &Error{StatusCode: resp.StatusCode, Code: "REQUEST_FAILED", Message: truncate(string(raw), 300)}
	}
	return raw, resp.Header.Get("Content-Type"), nil
}

// --- Health / status ---

// Health is GET /api/health (public).
func (c *Client) Health(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/health", nil, nil, &out)
}

// RbacStatus is GET /api/rbac/status (version + migrations, public).
func (c *Client) RbacStatus(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/rbac/status", nil, nil, &out)
}

// AppConfig is GET /api/config (public).
func (c *Client) AppConfig(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/config", nil, nil, &out)
}

// Whoami is GET /api/rbac/auth/profile.
func (c *Client) Whoami(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/rbac/auth/profile", nil, nil, &out)
}

// Validate is GET /api/rbac/auth/validate.
func (c *Client) Validate(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/rbac/auth/validate", nil, nil, &out)
}

// --- Connections (read + test only; create/delete stay UI-only) ---

// ConnectionsList is GET /api/rbac/connections.
func (c *Client) ConnectionsList(ctx context.Context, search string, limit int) (map[string]any, error) {
	q := url.Values{}
	if search != "" {
		q.Set("search", search)
	}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	var raw any
	if err := c.DoJSON(ctx, http.MethodGet, "/api/rbac/connections", q, nil, &raw); err != nil {
		return nil, err
	}
	return map[string]any{"data": raw}, nil
}

// ConnectionTest probes without saving: POST /api/rbac/connections/test.
func (c *Client) ConnectionTest(ctx context.Context, payload map[string]any) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/rbac/connections/test", nil, payload, &out)
}

// ConnectionUse probes a saved connection: POST /api/rbac/connections/:id/connect.
func (c *Client) ConnectionUse(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/rbac/connections/"+id+"/connect", nil, nil, &out)
}

// CanAccess is POST /api/rbac/data-access/check.
func (c *Client) CanAccess(ctx context.Context, payload map[string]any) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/rbac/data-access/check", nil, payload, &out)
}

// --- Query ---

// QueryExecute is POST /api/query/execute.
func (c *Client) QueryExecute(ctx context.Context, query, format string, maxRows int) (map[string]any, error) {
	body := map[string]any{"query": query}
	if format != "" {
		body["format"] = format
	}
	if maxRows > 0 {
		body["maxResultRows"] = maxRows
	}
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/query/execute", nil, body, &out)
}

// QueryExplain is POST /api/query/explain (SELECT-only dry-run).
func (c *Client) QueryExplain(ctx context.Context, query, explainType string) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/query/explain", nil, map[string]any{"query": query, "type": explainType}, &out)
}

// QueryTableSelect is POST /api/query/table/select.
func (c *Client) QueryTableSelect(ctx context.Context, query string, maxRows int) (map[string]any, error) {
	body := map[string]any{"query": query}
	if maxRows > 0 {
		body["maxResultRows"] = maxRows
	}
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/query/table/select", nil, body, &out)
}

// QueryShow is POST /api/query/show.
func (c *Client) QueryShow(ctx context.Context, query string) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/query/show", nil, map[string]any{"query": query}, &out)
}

// DDLSimulate is POST /api/metrics/ddl/simulate (never executes).
func (c *Client) DDLSimulate(ctx context.Context, statement string) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodPost, "/api/metrics/ddl/simulate", nil, map[string]any{"statement": statement}, &out)
}

// --- Explorer ---

// ExplorerDatabases is GET /api/explorer/databases.
func (c *Client) ExplorerDatabases(ctx context.Context) (any, error) {
	var out any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/explorer/databases", nil, nil, &out)
}

// ExplorerTable is GET /api/explorer/table/:db/:table.
func (c *Client) ExplorerTable(ctx context.Context, db, table string) (map[string]any, error) {
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/explorer/table/"+url.PathEscape(db)+"/"+url.PathEscape(table), nil, nil, &out)
}

// ExplorerSample is GET /api/explorer/table/:db/:table/sample.
func (c *Client) ExplorerSample(ctx context.Context, db, table string, limit int) (map[string]any, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	var out map[string]any
	return out, c.DoJSON(ctx, http.MethodGet, "/api/explorer/table/"+url.PathEscape(db)+"/"+url.PathEscape(table)+"/sample", q, nil, &out)
}

// --- Generic passthrough for operator domains ---

// Get performs an authenticated GET returning decoded data.
func (c *Client) Get(ctx context.Context, path string, query url.Values) (any, error) {
	var out any
	return out, c.DoJSON(ctx, http.MethodGet, path, query, nil, &out)
}

// Post performs an authenticated POST returning decoded data.
func (c *Client) Post(ctx context.Context, path string, body any) (any, error) {
	var out any
	return out, c.DoJSON(ctx, http.MethodPost, path, nil, body, &out)
}

// Put performs an authenticated PUT returning decoded data.
func (c *Client) Put(ctx context.Context, path string, body any) (any, error) {
	var out any
	return out, c.DoJSON(ctx, http.MethodPut, path, nil, body, &out)
}

// Delete performs an authenticated DELETE returning decoded data.
func (c *Client) Delete(ctx context.Context, path string) (any, error) {
	var out any
	return out, c.DoJSON(ctx, http.MethodDelete, path, nil, nil, &out)
}

// UploadPreview posts a file slice for schema inference.
func (c *Client) UploadPreview(ctx context.Context, filePath, format string, hasHeader bool) (map[string]any, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filePath)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(part, f); err != nil {
		return nil, err
	}
	_ = w.WriteField("format", format)
	if hasHeader {
		_ = w.WriteField("hasHeader", "true")
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/upload/preview", &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if c.ConnectionID != "" {
		req.Header.Set("X-Connection-Id", c.ConnectionID)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, &Error{Code: "NETWORK_ERROR", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, &Error{StatusCode: resp.StatusCode, Code: "DECODE_ERROR", Message: truncate(string(raw), 300)}
	}
	if !env.Success {
		msg := "request failed"
		code := "REQUEST_FAILED"
		if env.Error != nil {
			msg, code = env.Error.Message, env.Error.Code
		}
		return nil, &Error{StatusCode: resp.StatusCode, Code: code, Message: msg}
	}
	var out map[string]any
	if len(env.Data) > 0 {
		_ = json.Unmarshal(env.Data, &out)
	}
	return out, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
