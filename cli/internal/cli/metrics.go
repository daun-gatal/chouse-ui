package cli

import (
	"net/url"
	"strconv"

	"github.com/spf13/cobra"
)

func newMetricsCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "metrics", Short: "ClickHouse-native observability (read-only)"}
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

	overview := &cobra.Command{Use: "overview", Short: "System stats + resources", Run: get("/api/metrics/stats", nil)}
	top := &cobra.Command{Use: "top-tables", Short: "Top tables by size", Run: get("/api/metrics/top-tables", nil)}
	errs := &cobra.Command{Use: "errors", Short: "Server errors over interval", Run: get("/api/metrics/errors", nil)}
	parts := &cobra.Command{Use: "parts-pressure", Short: "Merge/part pressure", Run: get("/api/metrics/parts-pressure", nil)}
	custom := &cobra.Command{
		Use:   "custom",
		Short: "Run a SELECT-only custom metric query",
		Run: get("/api/metrics/custom", func(q url.Values) {
			q.Set("query", query)
		}),
	}
	custom.Flags().StringVar(&query, "query", "", "SELECT … (required)")
	_ = custom.MarkFlagRequired("query")

	simulate := &cobra.Command{
		Use:   "simulate <ALTER …>",
		Short: "Estimate ALTER UPDATE/DELETE impact (never executes)",
		Args:  cobra.MinimumNArgs(1),
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
	cmd := &cobra.Command{Use: "logs", Short: "Query-log views (read-only)"}
	var window, limit int
	mk := func(view string) *cobra.Command {
		return &cobra.Command{
			Use:   view,
			Short: "Show " + view,
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
	cmd := &cobra.Command{Use: "live", Short: "Running queries: list, then kill with --yes"}
	list := &cobra.Command{
		Use:   "list",
		Short: "List running queries (own scope unless kill_all)",
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
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
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
