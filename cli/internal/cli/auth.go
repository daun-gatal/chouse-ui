package cli

import (
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/config"
)

func newAuthCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Authenticate with a personal access token",
		Long: `Manage the personal access token (PAT) this CLI uses. Tokens are
stored 0600 in ~/.config/chouse/credentials.yaml and never printed (only a
masked form). Log in once per profile; every other command then just works.`,
		Example: `  chouse auth login --server https://chouse.corp:5521 --token ch_pat_…
  chouse auth status
  chouse auth whoami -o json`,
	}
	var tokenFlag, patAlias string

	login := &cobra.Command{
		Use:   "login",
		Short: "Store a PAT locally (0600)",
		Long: `Validate a personal access token against the server and store it
for the profile, remembering --server (and --profile as current) so later
commands need no flags. Prints a machine result honoring -o. Mint the token
once in the UI: Preferences → Personal access tokens.`,
		Example: `  chouse auth login --server https://chouse.corp:5521 --token ch_pat_…
  chouse auth login --server https://chouse.corp:5521 --token ch_pat_… --profile prod -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			_, resolved := mustClient(false)
			token := tokenFlag
			if token == "" {
				token = patAlias
			}
			if token == "" {
				token = os.Getenv(config.EnvToken)
			}
			if token == "" {
				fail(api.ExitUsage, "pass --token ch_pat_… or set CH_HOUSE_PAT (mint once in the UI: Preferences → Personal access tokens)")
			}
			c := api.New(resolved.Server, token, resolved.Connection)
			c.HTTP.Timeout = time.Duration(timeoutSecs()) * time.Second
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			if _, err := c.Validate(ctx); err != nil {
				failErr(fmt.Errorf("token validation failed: %w", err))
			}
			if err := config.SaveCredentials(resolved.Profile, token); err != nil {
				fail(api.ExitServer, err.Error())
			}
			// Remember explicitly-passed setup: the server for this profile, and
			// the profile itself as current. Env-derived values stay
			// session-scoped and are never written to disk.
			if err := config.SaveProfile(resolved.Profile, flagServer, flagProfile != ""); err != nil {
				fail(api.ExitUsage, err.Error())
			}
			if !flagQuiet {
				fmt.Fprintf(os.Stderr, "stored PAT for profile %q (masked %s)\n", resolved.Profile, config.MaskToken(token))
			}
			render(resolved, map[string]any{"profile": resolved.Profile, "server": resolved.Server})
		},
	}
	login.Flags().StringVar(&tokenFlag, "token", "", "PAT value (or CH_HOUSE_PAT)")
	login.Flags().StringVar(&patAlias, "pat", "", "deprecated alias for --token")
	_ = login.Flags().MarkDeprecated("pat", "use --token instead")

	status := &cobra.Command{
		Use:   "status",
		Short: "Show effective profile without printing secrets",
		Long: `Show the resolved profile, server, connection, and masked token —
fully offline, safe to run any time to check what later commands will use.`,
		Example: `  chouse auth status
  chouse auth status -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			resolved := mustConfig()
			server := resolved.Server
			if server == "" {
				server = "(not configured)"
			}
			render(resolved, map[string]any{
				"profile":    resolved.Profile,
				"server":     server,
				"connection": resolved.Connection,
				"token":      config.MaskToken(resolved.Token),
				"output":     resolved.Output,
			})
		},
	}

	whoami := &cobra.Command{
		Use:   "whoami",
		Short: "Show live user, roles, and permissions",
		Long: `Ask the server who the configured token belongs to, including
roles and data-access rules. Needs a server and a token; fails closed
otherwise.`,
		Example: `  chouse auth whoami
  chouse auth whoami -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			me, err := c.Whoami(ctx)
			if err != nil {
				failErr(err)
			}
			render(resolved, me)
		},
	}

	logout := &cobra.Command{
		Use:   "logout",
		Short: "Remove the locally stored PAT",
		Long: `Delete the stored token for the profile from this machine only.
The server-side token stays valid — revoke it in the UI to fully retire it.`,
		Example: `  chouse auth logout
  chouse auth logout --profile prod -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			resolved := mustConfig()
			if err := config.DeleteCredentials(resolved.Profile); err != nil {
				fail(api.ExitServer, err.Error())
			}
			if !flagQuiet {
				fmt.Fprintf(os.Stderr, "removed PAT for profile %q\n", resolved.Profile)
			}
			render(resolved, map[string]any{"profile": resolved.Profile, "removed": true})
		},
	}

	cmd.AddCommand(login, status, whoami, logout)
	return cmd
}
