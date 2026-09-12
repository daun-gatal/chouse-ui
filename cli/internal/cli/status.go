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
			rbac, err := c.RbacStatus(ctx)
			if err != nil {
				failErr(err)
			}
			render(resolved, map[string]any{"health": health, "rbac": rbac, "server": resolved.Server})
		},
	}
	return cmd
}
