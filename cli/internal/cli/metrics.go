package cli

import (
	"net/url"
	"strconv"

	"github.com/spf13/cobra"
)

func newMetricsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "metrics",
		Short: "ClickHouse-native observability (read-only)",
		Long: `Cluster stats, top tables, error views, custom SELECT metrics,
and ALTER impact simulation. Everything here reads; simulate never executes
— the safe way to sanity-check a mutation before running it for real.`,
		Example: `  chouse metrics overview
  chouse metrics top-tables --limit 5 -o json
  chouse metrics simulate "ALTER TABLE t UPDATE x = 1 WHERE id = 2"`,
	}
	var interval, limit int
	var query string

	get := func(path string, extra func(url.Values)) func(*cobra.Command, []string) {
		return func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
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
			got, err := c.Get(ctx, path, q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		}
	}

	overview := &cobra.Command{
		Use:   "overview",
		Short: "System stats + resources",
		Long:  `Cluster-wide stats and resource pressure over --interval minutes. First stop when something feels slow.`,
		Example: `  chouse metrics overview
  chouse metrics overview --interval 5 -o json`,
		Run: get("/api/metrics/stats", nil),
	}
	top := &cobra.Command{
		Use:   "top-tables",
		Short: "Top tables by size",
		Long:  `Largest tables by bytes on disk. Use it to find disk hogs before reaching for TTLs or drops.`,
		Example: `  chouse metrics top-tables
  chouse metrics top-tables --limit 5 -o json`,
		Run: get("/api/metrics/top-tables", nil),
	}
	errs := &cobra.Command{
		Use:   "errors",
		Short: "Server errors over interval",
		Long:  `Recent server-side errors with samples and counts. Needs system.query_log on the cluster.`,
		Example: `  chouse metrics errors
  chouse metrics errors --interval 60 -o json`,
		Run: get("/api/metrics/errors", nil),
	}
	parts := &cobra.Command{
		Use:   "parts-pressure",
		Short: "Merge/part pressure",
		Long:  `Merge and part pressure across the cluster. Sustained pressure here explains slow inserts before disks fill.`,
		Example: `  chouse metrics parts-pressure
  chouse metrics parts-pressure -o json`,
		Run: get("/api/metrics/parts-pressure", nil),
	}
	custom := &cobra.Command{
		Use:     "custom",
		Short:   "Run a SELECT-only custom metric query",
		Long:    `Run your own SELECT as a metric query (--query required). Anything non-SELECT is refused client-side.`,
		Example: `  chouse metrics custom --query "SELECT count() FROM system.query_log" -o json`,
		Run: get("/api/metrics/custom", func(q url.Values) {
			q.Set("query", query)
		}),
	}
	custom.Flags().StringVar(&query, "query", "", "SELECT … (required)")
	_ = custom.MarkFlagRequired("query")

	simulate := &cobra.Command{
		Use:   "simulate <ALTER …>",
		Short: "Estimate ALTER UPDATE/DELETE impact (never executes)",
		Long: `Estimate how many rows an ALTER UPDATE/DELETE would touch without
executing it. Always safe — pair it with query --raw --dry-run when planning
a mutation.`,
		Example: `  chouse metrics simulate "ALTER TABLE t UPDATE x = 1 WHERE id = 2"
  chouse metrics simulate "ALTER TABLE analytics.events DELETE WHERE day < today() - 30" -o json`,
		Args: cobra.MinimumNArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.DDLSimulate(ctx, joinArgs(args))
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	cmd.AddCommand(overview, top, errs, parts, custom, simulate)
	cmd.PersistentFlags().IntVar(&interval, "interval", 60, "minutes")
	cmd.PersistentFlags().IntVar(&limit, "limit", 20, "max rows")
	return cmd
}

func newLogsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "logs",
		Short: "Query-log views (read-only)",
		Long: `Canned views over system.query_log: slow/error queries, patterns,
per-table activity, and a histogram. Tune --window/--limit; all read-only.`,
		Example: `  chouse logs queries --limit 5
  chouse logs patterns --window 60 -o json`,
	}
	var window, limit int
	mk := func(view string) *cobra.Command {
		return &cobra.Command{
			Use:     view,
			Short:   "Show " + view,
			Long:    "Show the " + view + " query-log view over --window minutes, capped at --limit rows. Read-only.",
			Example: "  chouse logs " + view + " --limit 5\n  chouse logs " + view + " --window 30 -o json",
			Run: func(_ *cobra.Command, _ []string) {
				c, resolved := mustClient(true)
				ctx, cancel := ctxWithTimeout()
				defer cancel()
				q := url.Values{}
				q.Set("interval", itoa(window))
				q.Set("limit", itoa(limit))
				got, err := c.Get(ctx, "/api/metrics/recent-queries", q)
				if err != nil {
					failErr(err)
				}
				render(resolved, map[string]any{"view": view, "data": got})
			},
		}
	}
	for _, v := range []string{"queries", "patterns", "tables", "histogram"} {
		cmd.AddCommand(mk(v))
	}
	cmd.PersistentFlags().IntVar(&window, "window", 60, "minutes")
	cmd.PersistentFlags().IntVar(&limit, "limit", 50, "max rows")
	return cmd
}

func newLiveCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "live",
		Short: "Running queries: list, then kill with --yes",
		Long: `See what's running right now and kill runaways. Listing is
read-only; kill is destructive and needs --yes outside a TTY. Find the
query_id in list output first — never guess it.`,
		Example: `  chouse live list -o json
  chouse live kill q_abc123 --yes`,
	}
	list := &cobra.Command{
		Use:   "list",
		Short: "List running queries (own scope unless kill_all)",
		Long:  `List running queries with ids, users, and runtimes. Your scope covers your own queries unless you hold kill_all.`,
		Example: `  chouse live list
  chouse live list -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/live-queries", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	kill := &cobra.Command{
		Use:   "kill <queryId>",
		Short: "KILL a running query (destructive)",
		Long: `Kill one running query by id. Destructive and immediate — needs
--yes outside a TTY, and --dry-run is rejected (there is nothing safe to
preview). Copy the id from live list; a wrong id just 404s.`,
		Example: `  chouse live list -o json
  chouse live kill q_abc123 --yes`,
		Args: cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			rejectDryRun("live kill")
			confirmDestructive("live.kill", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Post(ctx, "/api/live-queries/kill", map[string]any{"queryId": args[0]})
			if err != nil {
				failErr(err)
			}
			auditLine("live.kill", args[0], "live_queries:kill(_all)")
			render(resolved, got)
		},
	}
	cmd.AddCommand(list, kill)
	return cmd
}

func itoa(v int) string {
	return strconv.Itoa(v)
}

func joinArgs(args []string) string {
	out := ""
	for i, a := range args {
		if i > 0 {
			out += " "
		}
		out += a
	}
	return out
}
