package cli

import (
	"github.com/spf13/cobra"
)

func newStatusCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Server health, version, and migration status",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(false)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			health, err := c.Health(ctx)
			if err != nil {
				failErr(err)
			}
			// /api/health and /api/config are public. /api/rbac/status is NOT
			// in the protection-middleware public list, so it needs the PAT
			// exemption — skip it with a hint when no token is configured.
			out := map[string]any{"health": health, "server": resolved.Server}
			if config, err := c.AppConfig(ctx); err == nil {
				out["config"] = config
			}
			if resolved.Token == "" {
				out["rbac"] = map[string]any{"status": "login required for version/migrations (chouse auth login --token ch_pat_…)"}
			} else if rbac, err := c.RbacStatus(ctx); err != nil {
				failErr(err)
			} else {
				out["rbac"] = rbac
			}
			render(resolved, out)
		},
	}
	return cmd
}
