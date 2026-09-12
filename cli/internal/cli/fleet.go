package cli

import (
	"net/url"

	"github.com/spf13/cobra"
)

func newFleetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fleet",
		Short: "Every cluster at once (read-only snapshots)",
		Long: `Fleet-wide snapshots, history, and fixed server-side metrics —
one view across all clusters. Everything here reads; metric names are fixed
server-side, so there is no ad-hoc SQL to get wrong.`,
		Example: `  chouse fleet list
  chouse fleet history --metric summary --limit 5 -o json`,
	}
	var from, to, metric string
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "Cached per-cluster snapshots (fast)",
		Long:  `Cached per-cluster snapshots — the fastest fleet overview. For fresh numbers, use history or query instead.`,
		Example: `  chouse fleet list
  chouse fleet list -o json`,
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
		Long:  `Fleet metric history over an RFC3339 window (--from/--to), one metric at a time. Defaults cover the recent summary window.`,
		Example: `  chouse fleet history --limit 5
  chouse fleet history --metric summary --from 2026-09-01T00:00:00Z -o json`,
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
		Use:     "query <connectionId> <metric>",
		Short:   "Fixed server-side metric (no ad-hoc SQL)",
		Long:    `Fetch one fixed server-side metric for one connection. Metric names are allow-listed server-side — list them via doctor reports or fleet history first.`,
		Example: `  chouse fleet query 57c2b5bf-0081-4880-9a05-057d1ec3b098 summary -o json`,
		Args:    cobra.ExactArgs(2),
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
	cmd := &cobra.Command{
		Use:   "doctor",
		Short: "Autonomous read-only AI SRE (LLM cost on scan)",
		Long: `Read past AI SRE reports for free; a fresh scan costs LLM budget
and writes a report row, so scan needs --yes like any mutation. Never
mutates data — advisory only.`,
		Example: `  chouse doctor reports
  chouse doctor get rpt_abc123 -o json
  chouse doctor scan --hours 24 --yes`,
	}
	var model string
	var hours int
	var connections []string

	scan := &cobra.Command{
		Use:   "scan",
		Short: "Run a fleet scan (advisory only, never mutates)",
		Long: `Run a fresh AI SRE scan over --hours of fleet history (optionally
one --model and a --connections subset). Consumes LLM budget and writes a
report row — hence --yes. For past results without spending, see reports.`,
		Example: `  chouse doctor scan --yes
  chouse doctor scan --hours 12 --model m_abc --yes -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			if !flagQuiet {
				printlnStderr("warning: doctor scan consumes LLM budget and writes a report row")
			}
			rejectDryRun("doctor scan")
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
		Long:  `List persisted AI SRE reports — free to read, no scan cost. Grab an id for get.`,
		Example: `  chouse doctor reports
  chouse doctor reports -o json`,
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
		Long:  `Show one persisted AI SRE report in full. Free to read — only scan spends budget.`,
		Example: `  chouse doctor get rpt_abc123
  chouse doctor get rpt_abc123 -o json`,
		Args: cobra.ExactArgs(1),
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
		Long:  `Show the AI SRE scan schedule (cadence, enabled flag, next run). Read-only.`,
		Example: `  chouse doctor schedule
  chouse doctor schedule -o json`,
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
