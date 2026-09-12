package cli

import (
	"net/url"

	"github.com/spf13/cobra"
)

func newFleetCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "fleet", Short: "Every cluster at once (read-only snapshots)"}
	var from, to, metric string
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "Cached per-cluster snapshots (fast)",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/fleet/snapshots", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	history := &cobra.Command{
		Use:   "history",
		Short: "Fleet history window",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if from != "" {
				q.Set("from", from)
			}
			if to != "" {
				q.Set("to", to)
			}
			if metric != "" {
				q.Set("metric", metric)
			}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			got, err := c.Get(ctx, "/api/fleet/history", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	history.Flags().StringVar(&from, "from", "", "RFC3339 start")
	history.Flags().StringVar(&to, "to", "", "RFC3339 end")
	history.Flags().StringVar(&metric, "metric", "summary", "metric name")
	history.Flags().IntVar(&limit, "limit", 100, "max rows")

	query := &cobra.Command{
		Use:   "query <connectionId> <metric>",
		Short: "Fixed server-side metric (no ad-hoc SQL)",
		Args:  cobra.ExactArgs(2),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Post(ctx, "/api/fleet/query", map[string]any{"connectionId": args[0], "metric": args[1]})
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	cmd.AddCommand(list, history, query)
	return cmd
}

func newDoctorCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "doctor", Short: "Autonomous read-only AI SRE (LLM cost on scan)"}
	var model string
	var hours int
	var connections []string

	scan := &cobra.Command{
		Use:   "scan",
		Short: "Run a fleet scan (advisory only, never mutates)",
		Run: func(_ *cobra.Command, _ []string) {
			if !flagQuiet {
				printlnStderr("warning: doctor scan consumes LLM budget and writes a report row")
			}
			confirmDestructive("doctor.scan", "fleet")
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			body := map[string]any{"hours": hours}
			if model != "" {
				body["modelId"] = model
			}
			if len(connections) > 0 {
				body["connectionIds"] = connections
			}
			got, err := c.Post(ctx, "/api/fleet/doctor/scan", body)
			if err != nil {
				failErr(err)
			}
			auditLine("doctor.scan", "fleet", "doctor:run")
			render(resolved, got)
		},
	}
	scan.Flags().StringVar(&model, "model", "", "model ID (default server-side)")
	scan.Flags().IntVar(&hours, "hours", 24, "lookback 1..72")
	scan.Flags().StringSliceVar(&connections, "connections", nil, "subset of connection IDs")

	reports := &cobra.Command{
		Use:   "reports",
		Short: "List persisted reports",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/fleet/doctor/reports", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	get := &cobra.Command{
		Use:   "get <reportId>",
		Short: "Show one report",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/fleet/doctor/reports/"+args[0], nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	schedule := &cobra.Command{
		Use:   "schedule",
		Short: "Show doctor schedule",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/fleet/doctor/schedule", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	cmd.AddCommand(scan, reports, get, schedule)
	return cmd
}
