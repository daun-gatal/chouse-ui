package cli

import (
	"github.com/spf13/cobra"
)

func newVersionCmd(version, commit, date string) *cobra.Command {
	if version == "" {
		version = "dev"
	}
	return &cobra.Command{
		Use:   "version",
		Short: "Print CLI version and server version",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(false)
			info := map[string]any{"cli": version, "commit": commit, "date": date}
			if ctx, cancel := ctxWithTimeout(); true {
				defer cancel()
				if status, err := c.RbacStatus(ctx); err == nil {
					info["server"] = status["version"]
					info["migrations"] = status["migrations"]
				} else {
					info["server"] = "unreachable: " + err.Error()
				}
			}
			render(resolved, info)
		},
	}
}
