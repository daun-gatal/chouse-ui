package cli

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMCPClientConfigCoversEveryClient(t *testing.T) {
	const endpoint = "https://chouse.corp/mcp"
	for _, client := range mcpClients {
		snippet, err := mcpClientConfig(client, endpoint)
		if err != nil {
			t.Fatalf("%s: %v", client, err)
		}
		if !strings.Contains(snippet, endpoint) {
			t.Errorf("%s: snippet does not point at the endpoint:\n%s", client, snippet)
		}
		if strings.Contains(snippet, "ch_pat_") {
			t.Errorf("%s: snippet must never inline a token:\n%s", client, snippet)
		}
		if !strings.Contains(snippet, "CH_HOUSE_PAT") && !strings.Contains(snippet, "${input:chouse_pat}") {
			t.Errorf("%s: snippet must read the token from CH_HOUSE_PAT or a prompt:\n%s", client, snippet)
		}
		if strings.HasPrefix(strings.TrimSpace(snippet), "{") {
			var parsed map[string]any
			if err := json.Unmarshal([]byte(snippet), &parsed); err != nil {
				t.Errorf("%s: invalid JSON: %v", client, err)
			}
		}
	}
}

func TestMCPClientConfigRejectsUnknownClient(t *testing.T) {
	if _, err := mcpClientConfig("notepad", "https://x/mcp"); err == nil || !strings.Contains(err.Error(), "claude-code") {
		t.Fatalf("want an error listing the clients, got %v", err)
	}
}

func TestMCPAndAgentsCommandsAreReadOnly(t *testing.T) {
	root := NewRoot("test", "", "")
	for _, path := range [][]string{{"mcp", "status"}, {"mcp", "tools"}, {"mcp", "config"}, {"mcp", "settings"}, {"agents", "summary"}, {"agents", "sessions"}, {"agents", "session"}, {"agents", "policies"}} {
		cmd, _, err := root.Find(path)
		if err != nil || cmd.Name() != path[1] {
			t.Errorf("missing command %v", path)
		}
	}
	// No subcommand may change server-side MCP or agent settings: those stay
	// in the UI (enable, tool switches, policies, pause).
	for _, parent := range []string{"mcp", "agents"} {
		cmd, _, _ := root.Find([]string{parent})
		for _, sub := range cmd.Commands() {
			for _, verb := range []string{"enable", "disable", "set", "pause", "resume", "delete"} {
				if sub.Name() == verb || strings.HasPrefix(sub.Name(), verb+"-") {
					t.Errorf("%s %s looks like a write; MCP and agent settings are UI-only", parent, sub.Name())
				}
			}
		}
	}
}
