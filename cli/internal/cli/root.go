package cli

import (
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// NewRoot builds the command tree on the process streams (used by docs
// generation and tests that only inspect the tree).
func NewRoot(version, commit, date string) *cobra.Command {
	app := &App{Streams: StdStreams(), version: version, commit: commit, date: date}
	return app.newRoot()
}

func (a *App) newRoot() *cobra.Command {
	if a.version == "" {
		a.version = "dev"
	}
	root := &cobra.Command{
		Use:   "chouse",
		Short: "Operate CHouse UI from the terminal, scripts and CI",
		Long: `chouse operates CHouse UI without a browser: query, explore, monitor
the fleet, run the AI doctor, manage scheduled work and data health, and
govern AI agents — authenticated with a personal access token (ch_pat_…).

Output is a table in a terminal and JSON when piped; pick one with -o.

Safe by default: reads never prompt; commands that change things ask first
(and need --yes without a terminal, failing closed before any request), and
--dry-run previews where the server can.`,
		Example: `  # First run: store a token for a server (prompts for the token)
  chouse auth login --server https://chouse.corp

  # Everyday reads
  chouse status
  chouse query "SELECT number FROM system.numbers LIMIT 5"
  chouse table list -c prod

  # Scripts: JSON on stdout, exit codes for control flow
  chouse live list -o json | jq -r '.queries[].query_id'

  # Changes: preview, then approve explicitly
  chouse query --raw --dry-run "ALTER TABLE t DELETE WHERE id = 2"
  chouse live kill q_abc123 --yes`,
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       a.version,
	}
	root.SetVersionTemplate("chouse {{.Version}}\n")

	f := root.PersistentFlags()
	f.StringVar(&a.server, "server", "", "CHouse UI server URL (env CHOUSE_SERVER)")
	f.StringVar(&a.token, "token", "", "personal access token ch_pat_… (env CH_HOUSE_PAT; prefer the env or auth login)")
	f.StringVar(&a.profile, "profile", "", "config profile (env CHOUSE_PROFILE)")
	f.StringVarP(&a.connection, "connection", "c", "", "ClickHouse connection name or id (env CHOUSE_CONNECTION)")
	f.StringVarP(&a.output, "output", "o", "", "output format: "+strings.Join(output.Formats, "|")+" (default auto: table on a terminal, json when piped; env CHOUSE_OUTPUT)")
	f.BoolVar(&a.noHeaders, "no-headers", false, "omit the header row in table and csv output")
	f.BoolVar(&a.wide, "wide", false, "do not truncate long table cells")
	f.BoolVarP(&a.quiet, "quiet", "q", false, "no notes on stderr (results and errors still print)")
	f.IntVar(&a.timeout, "timeout", 60, "request timeout in seconds (1-600)")
	f.BoolVar(&a.yes, "yes", false, "approve changes without a prompt (required without a terminal)")
	f.BoolVar(&a.dryRun, "dry-run", false, "preview a change without making it, where supported")
	f.StringVar(&a.caCert, "ca-cert", "", "PEM CA bundle to trust for the server, e.g. an internal CA (env CHOUSE_CA_CERT)")
	f.BoolVar(&a.insecure, "insecure-skip-tls-verify", false, "do not verify the server certificate — debugging only (env CHOUSE_INSECURE_SKIP_TLS_VERIFY)")
	f.BoolVar(&a.debug, "debug", false, "trace each request (method, path, status, time, request id) on stderr; never prints tokens")

	_ = root.RegisterFlagCompletionFunc("output", func(*cobra.Command, []string, string) ([]string, cobra.ShellCompDirective) {
		return output.Formats, cobra.ShellCompDirectiveNoFileComp
	})

	root.AddGroup(
		&cobra.Group{ID: "start", Title: "Getting started:"},
		&cobra.Group{ID: "data", Title: "Query and explore:"},
		&cobra.Group{ID: "ops", Title: "Operate:"},
		&cobra.Group{ID: "observe", Title: "Data observability:"},
		&cobra.Group{ID: "agents", Title: "AI and agents:"},
	)
	add := func(group string, cmds ...*cobra.Command) {
		for _, c := range cmds {
			c.GroupID = group
			root.AddCommand(c)
		}
	}
	add("start", a.newStatusCmd(), a.newAuthCmd(), a.newConfigCmd(), a.newConnectionCmd(), a.newVersionCmd())
	add("data", a.newQueryCmd(), a.newTableCmd(), a.newSavedCmd(), a.newUploadCmd())
	add("ops", a.newMetricsCmd(), a.newLogsCmd(), a.newLiveCmd(), a.newFleetCmd(), a.newScheduledCmd(), a.newAlertCmd(), a.newAuditCmd())
	add("observe", a.newHealthCmd(), a.newLineageCmd(), a.newIncidentsCmd(), a.newRemediationCmd())
	add("agents", a.newAICmd(), a.newDoctorCmd(), a.newAgentsCmd(), a.newMCPCmd())
	strictGroups(root)
	return root
}

// strictGroups makes a command group fail on an unknown subcommand instead
// of printing help and exiting 0, so a typo in a script is an error.
func strictGroups(c *cobra.Command) {
	for _, sub := range c.Commands() {
		if sub.HasSubCommands() && sub.Run == nil && sub.RunE == nil {
			sub.Args = cobra.ArbitraryArgs
			sub.RunE = func(cmd *cobra.Command, args []string) error {
				if len(args) > 0 {
					return usagef("unknown command %q for %q (see %s --help)", args[0], cmd.CommandPath(), cmd.CommandPath())
				}
				return cmd.Help()
			}
		}
		strictGroups(sub)
	}
}
