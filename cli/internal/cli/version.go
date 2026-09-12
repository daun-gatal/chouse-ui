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
		Long: `Print the CLI binary version, build commit, and date. Always
offline and instant — it never contacts a server, so it doubles as the
install check. For the server side, see chouse status.`,
		Example: `  chouse version
  chouse version -o json`,
		// Deliberately offline: version is the install-verification command
		// and must never block on (or require) a configured server.
		Run: func(_ *cobra.Command, _ []string) {
			resolved := mustConfig()
			render(resolved, map[string]any{"cli": version, "commit": commit, "date": date})
		},
	}
}
