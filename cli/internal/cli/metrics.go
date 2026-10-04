package cli

import (
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
	"github.com/daun-gatal/chouse-ui/cli/internal/safety"
)

func (a *App) newMetricsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "metrics",
		Short: "ClickHouse server metrics (read-only)",
		Long: `Server stats, the largest tables, recent errors, part pressure,
your own SELECT as a metric, and the impact of an ALTER UPDATE/DELETE —
which is estimated, never run.`,
		Example: `  chouse metrics overview
  chouse metrics top-tables --limit 5
  chouse metrics simulate "ALTER TABLE t DELETE WHERE day < today() - 30"`,
	}
	var interval, limit int
	var query string

	get := func(path string, v output.View, extra func(url.Values)) func(*cobra.Command, []string) error {
		return a.action(needAuth, func(s *Session, _ []string) error {
			q := url.Values{}
			if interval > 0 {
				q.Set("interval", itoa(interval))
			}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			if extra != nil {
				extra(q)
			}
			got, err := s.Client.Get(s.Ctx, path, q)
			if err != nil {
				return err
			}
			return s.Print(got, v)
		})
	}

	overview := &cobra.Command{
		Use:     "overview",
		Short:   "Server stats and resource use",
		Example: `  chouse metrics overview`,
		Args:    cobra.NoArgs,
		RunE:    get("/api/metrics/stats", output.View{}, nil),
	}
	top := &cobra.Command{
		Use:     "top-tables",
		Short:   "Largest tables",
		Example: `  chouse metrics top-tables --limit 5`,
		Args:    cobra.NoArgs,
		RunE:    get("/api/metrics/top-tables", output.View{}, nil),
	}
	errs := &cobra.Command{
		Use:     "errors",
		Short:   "Server errors in the last --interval minutes",
		Example: `  chouse metrics errors --interval 60`,
		Args:    cobra.NoArgs,
		RunE:    get("/api/metrics/errors", output.View{}, nil),
	}
	parts := &cobra.Command{
		Use:     "parts-pressure",
		Short:   "Tables with too many parts or slow merges",
		Example: `  chouse metrics parts-pressure`,
		Args:    cobra.NoArgs,
		RunE:    get("/api/metrics/parts-pressure", output.View{}, nil),
	}
	custom := &cobra.Command{
		Use:     "custom",
		Short:   "Run your own SELECT as a metric",
		Example: `  chouse metrics custom --query "SELECT count() FROM system.query_log"`,
		Args:    cobra.NoArgs,
		PreRunE: func(*cobra.Command, []string) error {
			if safety.Classify(query) != safety.IntentRead {
				return usagef("--query must be a single SELECT")
			}
			return nil
		},
		RunE: get("/api/metrics/custom", output.View{}, func(q url.Values) { q.Set("query", query) }),
	}
	custom.Flags().StringVar(&query, "query", "", "SELECT … (required)")
	_ = custom.MarkFlagRequired("query")

	simulate := &cobra.Command{
		Use:     "simulate <ALTER …>",
		Short:   "Estimate the rows an ALTER UPDATE/DELETE would touch (never runs it)",
		Example: `  chouse metrics simulate "ALTER TABLE t UPDATE x = 1 WHERE id = 2"`,
		Args:    cobra.MinimumNArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.DDLSimulate(s.Ctx, strings.Join(args, " "))
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}

	cmd.AddCommand(overview, top, errs, parts, custom, simulate)
	cmd.PersistentFlags().IntVar(&interval, "interval", 60, "window in minutes")
	cmd.PersistentFlags().IntVar(&limit, "limit", 20, "max rows")
	return cmd
}

func (a *App) newLogsCmd() *cobra.Command {
	var limit int
	var user string
	cmd := &cobra.Command{
		Use:   "logs",
		Short: "Recent queries from system.query_log",
		Long: `The most recent queries in ClickHouse's query log on the -c
connection, newest first: when, how long, and whether they finished or
failed. Filter by ClickHouse user with --user.`,
		Example: `  chouse logs
  chouse logs --user etl --limit 50 -o csv`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if limit < 1 || limit > 100 {
				return usagef("--limit must be between 1 and 100")
			}
			q := url.Values{}
			q.Set("limit", itoa(limit))
			if user != "" {
				q.Set("username", user)
			}
			got, err := s.Client.Get(s.Ctx, "/api/metrics/recent-queries", q)
			if err != nil {
				return err
			}
			return s.Print(got, view("", "TIME=event_time", "TYPE", "MS=query_duration_ms", "QUERY"))
		}),
	}
	cmd.Flags().IntVar(&limit, "limit", 20, "max rows (1-100)")
	cmd.Flags().StringVar(&user, "user", "", "only this ClickHouse user")
	return cmd
}

func (a *App) newLiveCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "live",
		Short: "Running queries: list, and kill runaways",
		Long: `See what is running on the -c connection and kill runaways. You
see your own queries unless you hold live_queries:kill_all. kill changes
things, so it asks first (or needs --yes).`,
		Example: `  chouse live list
  chouse live kill 8f1c… --yes`,
	}
	list := &cobra.Command{
		Use:     "list",
		Short:   "List running queries",
		Example: `  chouse live list -o json | jq -r '.queries[].query_id'`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/live-queries", nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{List: "queries", Columns: []output.Column{
				{Header: "query_id"}, {Header: "user", Path: "user"}, {Header: "elapsed_s", Path: "elapsed_seconds"},
				{Header: "read_rows"}, bytesCol("memory", "memory_usage"), {Header: "query"},
			}})
		}),
	}
	kill := &cobra.Command{
		Use:     "kill <queryId>",
		Short:   "Kill a running query",
		Example: `  chouse live kill 8f1c2d… --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("live kill"); err != nil {
				return err
			}
			if err := s.confirm("kill query", args[0]); err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, "/api/live-queries/kill", map[string]any{"queryId": args[0]})
			if err != nil {
				return err
			}
			s.audit("live.kill", args[0], "live_queries:kill")
			return s.Print(got, output.View{})
		}),
	}
	cmd.AddCommand(list, kill)
	return cmd
}
