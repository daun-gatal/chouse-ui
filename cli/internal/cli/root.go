// Package cli implements the chouse command tree (cobra).
package cli

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/config"
	"github.com/daun-gatal/chouse-ui/cli/internal/output"
	"github.com/daun-gatal/chouse-ui/cli/internal/safety"
)

// Globals bound to persistent flags.
var (
	flagServer     string
	flagToken      string
	flagProfile    string
	flagConnection string
	flagOutput     string
	flagQuiet      bool
	flagTimeout    int
	flagYes        bool
	flagDryRun     bool
)

// NewRoot builds the full command tree.
func NewRoot(version, commit, date string) *cobra.Command {
	root := &cobra.Command{
		Use:   "chouse",
		Short: "Safe browserless operations for CHouse UI",
		Long: `chouse operates CHouse UI without a browser: query, explore, monitor the fleet,
run the AI doctor, and manage scheduled work — authenticated with a personal
access token (ch_pat_…). Safe-by-default: destructive commands need --yes and
offer --dry-run previews.`,
		Example: `  # First run: point at a server and store a token (server is remembered)
  chouse auth login --server https://chouse.corp:5521 --token ch_pat_…

  # Everyday reads (never prompt, never mutate)
  chouse status
  chouse query "SELECT number FROM system.numbers LIMIT 5" -o json

  # Guarded writes: preview first, then approve explicitly
  chouse query --raw --dry-run "ALTER TABLE t UPDATE x = 1 WHERE id = 2"
  chouse live kill q_abc123 --yes`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.PersistentFlags().StringVar(&flagServer, "server", "", "CHouse UI server URL (env CHOUSE_SERVER)")
	root.PersistentFlags().StringVar(&flagToken, "token", "", "PAT ch_pat_… (env CH_HOUSE_PAT)")
	root.PersistentFlags().StringVar(&flagProfile, "profile", "", "config profile (env CHOUSE_PROFILE)")
	root.PersistentFlags().StringVarP(&flagConnection, "connection", "c", "", "ClickHouse connection ID (env CHOUSE_CONNECTION)")
	root.PersistentFlags().StringVarP(&flagOutput, "output", "o", "", "table|json|yaml|csv (env CHOUSE_OUTPUT)")
	root.PersistentFlags().BoolVarP(&flagQuiet, "quiet", "q", false, "minimal output for scripts")
	root.PersistentFlags().IntVar(&flagTimeout, "timeout", 60, "request timeout in seconds")
	root.PersistentFlags().BoolVar(&flagYes, "yes", false, "approve destructive actions (required in non-TTY)")
	root.PersistentFlags().BoolVar(&flagDryRun, "dry-run", false, "preview without executing where supported")

	root.AddCommand(
		newStatusCmd(),
		newAuthCmd(),
		newConnectionCmd(),
		newQueryCmd(),
		newTableCmd(),
		newSavedCmd(),
		newMetricsCmd(),
		newLogsCmd(),
		newLiveCmd(),
		newFleetCmd(),
		newDoctorCmd(),
		newScheduledCmd(),
		newHealthCmd(),
		newAlertCmd(),
		newAICmd(),
		newUploadCmd(),
		newAuditCmd(),
		newConfigCmd(),
		newVersionCmd(version, commit, date),
	)
	return root
}

// ctxWithTimeout bounds every request.
// timeoutSecs normalizes --timeout with the same clamp everywhere so the
// context deadline and the HTTP client cap never disagree (an uncapped
// --timeout above 60 used to be silently cut by the client).
func timeoutSecs() int {
	if flagTimeout <= 0 || flagTimeout > 600 {
		return 60
	}
	return flagTimeout
}

func ctxWithTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), time.Duration(timeoutSecs())*time.Second)
}

// mustClient resolves config and builds an authenticated client. Every
// caller needs a server (use mustConfig for serverless local commands),
// so a missing server fails fast with setup guidance (exit 2) instead of
// silently aiming at a phantom default.
func mustClient(requireAuth bool) (*api.Client, config.Resolved) {
	resolved := mustConfig()
	if err := resolved.RequireServer(); err != nil {
		fail(api.ExitUsage, err.Error())
	}
	if requireAuth {
		if err := resolved.RequireToken(); err != nil {
			fail(api.ExitAuth, err.Error())
		}
	}
	c := api.New(resolved.Server, resolved.Token, resolved.Connection)
	c.UserAgent = "chouse-cli/1"
	c.HTTP.Timeout = time.Duration(timeoutSecs()) * time.Second
	if flagOutput != "" {
		resolved.Output = flagOutput
	}
	return c, resolved
}

// mustConfig resolves config for serverless local commands (auth status,
// logout, version). It never requires a server or a token.
func mustConfig() config.Resolved {
	resolved, err := config.Resolve(config.Flags{
		Server:     flagServer,
		Token:      flagToken,
		Connection: flagConnection,
		Profile:    flagProfile,
		Output:     flagOutput,
	})
	if err != nil {
		fail(api.ExitUsage, err.Error())
	}
	if flagOutput != "" {
		resolved.Output = flagOutput
	}
	return resolved
}

// render prints a decoded payload honoring --output/--quiet.
func render(resolved config.Resolved, value any) {
	format := resolved.Output
	if format == "" {
		format = output.Table
	}
	if flagQuiet && format == output.Table {
		format = output.JSON
	}
	if err := output.Print(os.Stdout, format, value); err != nil {
		fail(api.ExitUsage, err.Error())
	}
}

// fail prints to stderr and exits with the machine contract code.
func fail(code int, msg string) {
	fmt.Fprintln(os.Stderr, "error: "+msg)
	os.Exit(code)
}

// failErr maps API errors to exit codes.
func failErr(err error) {
	if apiErr, ok := err.(*api.Error); ok {
		fail(apiErr.ExitCode(), apiErr.Error())
	}
	fail(api.ExitServer, err.Error())
}

// rejectDryRun fails fast for mutations with no preview support. Without it,
// --dry-run --yes would silently execute. Call before confirmDestructive.
func rejectDryRun(what string) {
	if flagDryRun {
		fail(api.ExitUsage, fmt.Sprintf("--dry-run is not supported for %s (it always executes; omit --dry-run or use a preview command)", what))
	}
}

// confirmDestructive enforces safe-by-default gating.
func confirmDestructive(action, target string) {
	if err := safety.RequireConfirm(safety.ConfirmOptions{Yes: flagYes, DryRun: flagDryRun, Action: action, Target: target}); err != nil {
		fail(api.ExitUsage, err.Error())
	}
}

// auditLine prints the mutation correlation line for every write.
func auditLine(action, target, permission string) {
	if !flagQuiet {
		fmt.Fprintf(os.Stderr, "action=%s target=%s permission=%s\n", action, target, permission)
	}
}

// uiOnly errors for v1-excluded admin surfaces with a UI hint.
func uiOnly(what, where string) {
	fail(api.ExitUsage, fmt.Sprintf("%s is UI-only in CLI v1 (use the browser: %s). Reason: %s", what, where, "break-glass admin stays behind UI review"))
}
