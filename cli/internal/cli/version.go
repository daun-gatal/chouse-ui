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
		Short: "Print CLI version (server info: chouse status)",
		// Deliberately offline: version is the install-verification command
		// and must never block on (or require) a configured server.
		Run: func(_ *cobra.Command, _ []string) {
			resolved := mustConfig()
			render(resolved, map[string]any{"cli": version, "commit": commit, "date": date})
		},
	}
}
