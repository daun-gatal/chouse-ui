// Package cli implements the chouse command tree (cobra).
package cli

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strconv"
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
	flagNoColor    bool
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
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.PersistentFlags().StringVar(&flagServer, "server", "", "CHouse UI server URL (env CHOUSE_SERVER)")
	root.PersistentFlags().StringVar(&flagToken, "token", "", "PAT ch_pat_… (env CH_HOUSE_PAT)")
	root.PersistentFlags().StringVar(&flagProfile, "profile", "", "config profile (env CHOUSE_PROFILE)")
	root.PersistentFlags().StringVarP(&flagConnection, "connection", "c", "", "ClickHouse connection ID (env CHOUSE_CONNECTION)")
	root.PersistentFlags().StringVarP(&flagOutput, "output", "o", "", "table|json|yaml|csv (env CHOUSE_OUTPUT)")
	root.PersistentFlags().BoolVarP(&flagQuiet, "quiet", "q", false, "minimal output for scripts")
	root.PersistentFlags().BoolVar(&flagNoColor, "no-color", false, "disable colors")
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
func ctxWithTimeout() (context.Context, context.CancelFunc) {
	secs := flagTimeout
	if secs <= 0 || secs > 600 {
		secs = 60
	}
	return context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
}

// mustClient resolves config and builds an authenticated client.
func mustClient(requireAuth bool) (*api.Client, config.Resolved) {
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
	if requireAuth {
		if err := resolved.RequireToken(); err != nil {
			fail(api.ExitAuth, err.Error())
		}
	}
	c := api.New(resolved.Server, resolved.Token, resolved.Connection)
	c.UserAgent = "chouse-cli/1"
	if flagOutput != "" {
		resolved.Output = flagOutput
	}
	return c, resolved
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

func intQuery(q url.Values, key string, v int) {
	if v > 0 {
		q.Set(key, strconv.Itoa(v))
	}
}
