package cli

import (
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// minServerVersion is the oldest server this CLI is tested against: the
// MCP, agents and observability commands need 3.14.
const minServerVersion = "3.14.0"

func (a *App) newStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Server health, version, compatibility and migration status",
		Long: `Probe the configured server: health, version and whether this CLI
supports it, plus (with a token) the RBAC migration state. Run it before
debugging anything else.`,
		Example: `  chouse status
  chouse status -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needServer, func(s *Session, _ []string) error {
			health, err := s.Client.Health(s.Ctx)
			if err != nil {
				return err
			}
			out := map[string]any{"server": s.Cfg.Server, "health": health["status"], "cli": a.version}
			if cfg, err := s.Client.AppConfig(s.Ctx); err == nil {
				if app, ok := cfg["app"].(map[string]any); ok {
					version, _ := app["version"].(string)
					out["serverVersion"] = version
					out["compatible"] = compatibility(version)
				}
				if features, ok := cfg["features"].(map[string]any); ok {
					out["mcpEnabled"] = features["mcpEnabled"]
				}
			}
			if s.Cfg.Token == "" {
				out["rbac"] = "log in for migration status (chouse auth login)"
			} else if rbac, err := s.Client.RbacStatus(s.Ctx); err == nil {
				out["rbac"] = rbac
			} else {
				return err
			}
			if c, _ := out["compatible"].(string); strings.HasPrefix(c, "no") {
				s.notef("warning: server %v is older than %s; some commands will fail", out["serverVersion"], minServerVersion)
			}
			return s.Print(out, output.View{})
		}),
	}
}

// compatibility compares a server version with minServerVersion. Builds
// without a release version ("dev") are assumed current.
func compatibility(version string) string {
	v := strings.TrimPrefix(strings.TrimSpace(version), "v")
	if v == "" || v == "dev" {
		return "unknown (development build)"
	}
	if versionLess(v, minServerVersion) {
		return "no (needs " + minServerVersion + " or later)"
	}
	return "yes"
}

// versionLess compares dotted numeric versions; pre-release suffixes are
// ignored and unparsable parts count as 0.
func versionLess(a, b string) bool {
	pa, pb := versionParts(a), versionParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	return false
}

func versionParts(v string) [3]int {
	var out [3]int
	core := strings.SplitN(v, "-", 2)[0]
	for i, part := range strings.SplitN(core, ".", 3) {
		n, _ := strconv.Atoi(part)
		out[i] = n
	}
	return out
}

func (a *App) newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the CLI version (server version: chouse status)",
		Long: `Print the CLI version, build commit and date. Always offline — it
never contacts a server, so it doubles as the install check. chouse status
shows the server version and whether this CLI supports it.`,
		Example: `  chouse version
  chouse version -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needNothing, func(s *Session, _ []string) error {
			return s.Print(map[string]any{"cli": a.version, "commit": a.commit, "date": a.date, "minServer": minServerVersion}, output.View{})
		}),
	}
}
