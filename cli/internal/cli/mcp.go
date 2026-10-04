package cli

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/config"
)

// mcpClients are the agent hosts `chouse mcp config` writes setup for.
var mcpClients = []string{"claude-code", "codex", "cursor", "vscode", "opencode"}

// mcpClientConfig is the setup for one agent host pointed at endpoint. The
// token is read from CH_HOUSE_PAT (or a secret prompt) — never inlined.
func mcpClientConfig(client, endpoint string) (string, error) {
	env := config.EnvToken
	asJSON := func(v any) string {
		raw, _ := json.MarshalIndent(v, "", "  ")
		return string(raw) + "\n"
	}
	switch client {
	case "claude-code":
		return fmt.Sprintf("claude mcp add --transport http chouse %s \\\n  --header \"Authorization: Bearer $%s\"\n", endpoint, env), nil
	case "codex":
		return fmt.Sprintf("codex mcp add chouse --url %s --bearer-token-env-var %s\n", endpoint, env), nil
	case "cursor":
		return asJSON(map[string]any{"mcpServers": map[string]any{"chouse": map[string]any{
			"url":     endpoint,
			"headers": map[string]string{"Authorization": "Bearer ${env:" + env + "}"},
		}}}), nil
	case "vscode":
		return asJSON(map[string]any{
			"servers": map[string]any{"chouse": map[string]any{
				"type":    "http",
				"url":     endpoint,
				"headers": map[string]string{"Authorization": "Bearer ${input:chouse_pat}"},
			}},
			"inputs": []map[string]any{{"id": "chouse_pat", "type": "promptString", "description": "CHouse UI personal access token", "password": true}},
		}), nil
	case "opencode":
		return asJSON(map[string]any{
			"$schema": "https://opencode.ai/config.json",
			"mcp": map[string]any{"chouse": map[string]any{
				"type":    "remote",
				"url":     endpoint,
				"enabled": true,
				"oauth":   false,
				"headers": map[string]string{"Authorization": "Bearer {env:" + env + "}"},
				"timeout": 60000,
			}},
		}), nil
	}
	return "", fmt.Errorf("unknown client %q (one of: %s)", client, strings.Join(mcpClients, ", "))
}

func newMCPCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mcp",
		Short: "The MCP endpoint for AI agents: status, tools, client setup",
		Long: `The server's MCP endpoint (ADR 0013, ADR 0017) is served at /mcp on the
same address as the UI. An administrator turns it on and picks the tools in
the UI (Agents › MCP); these commands show what your token gets there and
print setup for agent hosts. They never change the server's MCP settings.`,
		Example: `  chouse mcp status
  chouse mcp tools -o yaml
  chouse mcp config claude-code | sh`,
	}

	status := &cobra.Command{
		Use:   "status",
		Short: "Whether MCP is on, its endpoint, and how many tools your token gets",
		Long: `Report whether an administrator turned the MCP endpoint on, the URL
agents connect to (this server's address plus /mcp), and — when it is on and
a token is configured — how many tools that token gets.`,
		Example: `  chouse mcp status
  chouse mcp status -o json`,
		Args: cobra.NoArgs,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(false)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			cfg, err := c.AppConfig(ctx)
			if err != nil {
				failErr(err)
			}
			features, _ := cfg["features"].(map[string]any)
			enabled, known := features["mcpEnabled"].(bool)
			out := map[string]any{"endpoint": c.MCPEndpoint(), "enabled": enabled}
			if !known {
				out["enabled"] = nil
				out["note"] = "server does not report MCP status (older than 3.14.0)"
			}
			if enabled && resolved.Token != "" {
				tools, err := c.MCPTools(ctx)
				if err != nil {
					out["toolsError"] = err.Error()
				} else {
					out["tools"] = len(tools)
				}
			}
			if !enabled && known && !flagQuiet {
				fmt.Fprintln(os.Stderr, "MCP is off: an administrator can turn it on in the UI under Agents › MCP")
			}
			render(resolved, out)
		},
	}

	tools := &cobra.Command{
		Use:   "tools",
		Short: "The MCP tools your token gets",
		Long: `List the tools an agent using your token sees: the ones an
administrator turned on in Agents › MCP that your permissions allow.`,
		Example: `  chouse mcp tools
  chouse mcp tools -o yaml`,
		Args: cobra.NoArgs,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			list, err := c.MCPTools(ctx)
			if err != nil {
				failErr(err)
			}
			sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
			rows := make([]map[string]any, 0, len(list))
			for _, t := range list {
				access := "write"
				if t.Annotations.ReadOnlyHint {
					access = "read"
				} else if t.Annotations.DestructiveHint {
					access = "destructive"
				}
				rows = append(rows, map[string]any{"name": t.Name, "title": t.Title, "access": access, "description": t.Description})
			}
			render(resolved, rows)
		},
	}

	cfg := &cobra.Command{
		Use:   "config <" + strings.Join(mcpClients, "|") + ">",
		Short: "Print agent host setup for this server's MCP endpoint",
		Long: `Print ready-to-use setup that points an agent host at this profile's
server. The token is read from CH_HOUSE_PAT (VS Code prompts for it), so no
secret is written into a config file. Output is the raw snippet (it bypasses
-o): a shell command for claude-code/codex, JSON for the others.`,
		Example: `  chouse mcp config claude-code | sh
  chouse mcp config cursor > .cursor/mcp.json
  chouse mcp config vscode > .vscode/mcp.json`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: mcpClients,
		Run: func(_ *cobra.Command, args []string) {
			resolved := mustConfig()
			if err := resolved.RequireServer(); err != nil {
				fail(api.ExitUsage, err.Error())
			}
			snippet, err := mcpClientConfig(args[0], resolved.Server+api.MCPPath)
			if err != nil {
				fail(api.ExitUsage, err.Error())
			}
			fmt.Fprint(os.Stdout, snippet)
		},
	}

	settings := &cobra.Command{
		Use:   "settings",
		Short: "The server's MCP settings and every tool's state (agents:view)",
		Long: `Show what an administrator configured in Agents › MCP: whether the
endpoint is on, allowed origins, the tool call timeout, and every tool with
its access level, required permissions and whether it is on. Changing them
stays in the UI.`,
		Example: `  chouse mcp settings -o yaml`,
		Args:    cobra.NoArgs,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/agents/mcp", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	cmd.AddCommand(status, tools, cfg, settings)
	return cmd
}

// getAndRender is a read-only GET of path rendered with --output.
func getAndRender(path string, query map[string]string) {
	c, resolved := mustClient(true)
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	values := url.Values{}
	for key, value := range query {
		values.Set(key, value)
	}
	got, err := c.Get(ctx, path, values)
	if err != nil {
		failErr(err)
	}
	render(resolved, got)
}

func newAgentsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "agents",
		Short: "Agent activity: sessions, queries, budgets (agents:view)",
		Long: `What agents connected over MCP or with personal access tokens did:
sessions with their queries, bytes read and policy outcomes, and the budget
policies that apply. Read-only; policies and the pause switch stay in the UI.`,
		Example: `  chouse agents summary
  chouse agents sessions --days 7
  chouse agents session <sessionId>
  chouse agents policies`,
	}

	summary := &cobra.Command{
		Use:   "summary",
		Short: "Last 24 hours: active agents, queries, warnings, blocks, pause state",
		Long: `Agent activity over the last 24 hours: active agents and sessions,
queries and bytes read, results that carried a health warning, queries
blocked by a budget policy, and whether agent access is paused.`,
		Args:    cobra.NoArgs,
		Example: `  chouse agents summary -o yaml`,
		Run: func(_ *cobra.Command, _ []string) {
			getAndRender("/api/agents/summary", nil)
		},
	}

	var days int
	sessions := &cobra.Command{
		Use:   "sessions",
		Short: "Agent sessions in the last --days (1-30)",
		Long: `Every MCP and personal-access-token session in the window, newest
first, with its queries, bytes read and how many calls were warned or
blocked. A session is consecutive calls from one token with gaps under
30 minutes.`,
		Args:    cobra.NoArgs,
		Example: `  chouse agents sessions --days 7`,
		Run: func(_ *cobra.Command, _ []string) {
			if days < 1 || days > 30 {
				fail(api.ExitUsage, "--days must be between 1 and 30")
			}
			getAndRender("/api/agents/sessions", map[string]string{"days": itoa(days)})
		},
	}
	sessions.Flags().IntVar(&days, "days", 1, "window in days (1-30)")

	session := &cobra.Command{
		Use:   "session <sessionId>",
		Short: "One session with every tool call (replay)",
		Long: `Replay one session: every tool call with its arguments, outcome,
policy notices and bytes read. Arguments of other people's sessions need
query:history:view:all.`,
		Args:    cobra.ExactArgs(1),
		Example: `  chouse agents session pat-123:1790000000000`,
		Run: func(_ *cobra.Command, args []string) {
			getAndRender("/api/agents/sessions/"+url.PathEscape(args[0]), nil)
		},
	}

	policies := &cobra.Command{
		Use:   "policies",
		Short: "Budget policies (per token, per role, default)",
		Long: `Budget policies checked with EXPLAIN ESTIMATE before agent queries
run: per-query and daily read limits, partition-filter thresholds and what
happens on tables with an open incident. The most specific policy wins:
token, then role, then the default.`,
		Args:    cobra.NoArgs,
		Example: `  chouse agents policies -o yaml`,
		Run: func(_ *cobra.Command, _ []string) {
			getAndRender("/api/agents/policies", nil)
		},
	}

	cmd.AddCommand(summary, sessions, session, policies)
	return cmd
}
