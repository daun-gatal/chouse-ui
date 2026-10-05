package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// MCPPath is where the server serves MCP: on the web port, next to /api.
const MCPPath = "/mcp"

// MCPEndpoint is the MCP URL for this client's server.
func (c *Client) MCPEndpoint() string {
	return c.BaseURL + MCPPath
}

// MCPTool is one entry of an MCP tools/list result.
type MCPTool struct {
	Name        string `json:"name" yaml:"name"`
	Title       string `json:"title,omitempty" yaml:"title,omitempty"`
	Description string `json:"description" yaml:"description"`
	Annotations struct {
		ReadOnlyHint    bool `json:"readOnlyHint" yaml:"readOnly"`
		DestructiveHint bool `json:"destructiveHint" yaml:"destructive"`
	} `json:"annotations" yaml:"annotations"`
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// MCPCall sends one stateless JSON-RPC request to the MCP endpoint with the
// client's PAT and connection, and returns the raw result. The server
// answers either JSON or a one-event SSE stream; both are accepted.
func (c *Client) MCPCall(ctx context.Context, method string, params any) (json.RawMessage, error) {
	if params == nil {
		params = map[string]any{}
	}
	payload, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.MCPEndpoint(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if c.ConnectionID != "" {
		req.Header.Set("X-Connection-Id", c.ConnectionID)
	}
	if c.UserAgent != "" {
		req.Header.Set("User-Agent", c.UserAgent)
	}
	resp, err := c.do(req)
	if err != nil {
		// Ctrl-C and --timeout surface as themselves, not as a network fault.
		if ctxErr := req.Context().Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, &Error{Code: "NETWORK_ERROR", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, &Error{StatusCode: resp.StatusCode, Code: "READ_ERROR", Message: err.Error()}
	}
	if resp.StatusCode >= 400 {
		var env envelope
		if json.Unmarshal(raw, &env) == nil && !env.Success {
			return nil, withRequestID(decodeError(resp.StatusCode, raw), resp)
		}
		return nil, withRequestID(plainError(resp.StatusCode, raw), resp)
	}
	body := raw
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		body = firstSSEData(raw)
	}
	var rpc rpcResponse
	if err := json.Unmarshal(body, &rpc); err != nil {
		return nil, &Error{StatusCode: resp.StatusCode, Code: "DECODE_ERROR", Message: "not a JSON-RPC response: " + truncate(string(raw), 300)}
	}
	if rpc.Error != nil {
		return nil, &Error{StatusCode: resp.StatusCode, Code: fmt.Sprintf("MCP_%d", rpc.Error.Code), Message: rpc.Error.Message}
	}
	return rpc.Result, nil
}

// firstSSEData returns the data of the first SSE event (the stateless
// transport sends exactly one per request).
func firstSSEData(raw []byte) []byte {
	var data bytes.Buffer
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 0, 64<<10), 32<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			continue
		}
		if line == "" && data.Len() > 0 {
			break
		}
	}
	return data.Bytes()
}

// MCPTools lists the tools this token gets: the ones an administrator
// enabled in AI Governance › MCP that the token's permissions allow.
func (c *Client) MCPTools(ctx context.Context) ([]MCPTool, error) {
	result, err := c.MCPCall(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}
	var listed struct {
		Tools []MCPTool `json:"tools"`
	}
	if err := json.Unmarshal(result, &listed); err != nil {
		return nil, &Error{Code: "DECODE_ERROR", Message: err.Error()}
	}
	return listed.Tools, nil
}
