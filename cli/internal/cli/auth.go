package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/config"
)

func newAuthCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "auth", Short: "Authenticate with a personal access token"}
	var tokenFlag, patAlias string

	login := &cobra.Command{
		Use:   "login",
		Short: "Store a PAT locally (0600)",
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
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			if _, err := c.Validate(ctx); err != nil {
				failErr(fmt.Errorf("token validation failed: %w", err))
			}
			if err := config.SaveCredentials(resolved.Profile, token); err != nil {
				fail(api.ExitServer, err.Error())
			}
			fmt.Fprintf(os.Stderr, "stored PAT for profile %q (masked %s)\n", resolved.Profile, config.MaskToken(token))
		},
	}
	login.Flags().StringVar(&tokenFlag, "token", "", "PAT value (or CH_HOUSE_PAT)")
	login.Flags().StringVar(&patAlias, "pat", "", "deprecated alias for --token")
	_ = login.Flags().MarkDeprecated("pat", "use --token instead")

	status := &cobra.Command{
		Use:   "status",
		Short: "Show effective profile without printing secrets",
		Run: func(_ *cobra.Command, _ []string) {
			_, resolved := mustClient(false)
			render(resolved, map[string]any{
				"profile":    resolved.Profile,
				"server":     resolved.Server,
				"connection": resolved.Connection,
				"token":      config.MaskToken(resolved.Token),
				"output":     resolved.Output,
			})
		},
	}

	whoami := &cobra.Command{
		Use:   "whoami",
		Short: "Show live user, roles, and permissions",
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
		Run: func(_ *cobra.Command, _ []string) {
			_, resolved := mustClient(false)
			if err := config.DeleteCredentials(resolved.Profile); err != nil {
				fail(api.ExitServer, err.Error())
			}
			fmt.Fprintf(os.Stderr, "removed PAT for profile %q\n", resolved.Profile)
		},
	}

	cmd.AddCommand(login, status, whoami, logout)
	return cmd
}
