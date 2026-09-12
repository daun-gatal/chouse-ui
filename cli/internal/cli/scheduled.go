package cli

import (
	"net/url"
	"os"

	"github.com/spf13/cobra"
)

func newScheduledCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "scheduled", Short: "Scheduled queries (preview before create/run)"}
	var connection string
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List jobs",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if connection != "" {
				q.Set("connectionId", connection)
			}
			got, err := c.Get(ctx, "/api/scheduled-queries", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	list.Flags().StringVar(&connection, "connection", "", "filter by connection ID")

	get := &cobra.Command{
		Use:   "get <id>",
		Short: "Show one job",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/scheduled-queries/"+args[0], nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	runs := &cobra.Command{
		Use:   "runs <id>",
		Short: "Show run history",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			got, err := c.Get(ctx, "/api/scheduled-queries/"+args[0]+"/runs", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	runs.Flags().IntVar(&limit, "limit", 50, "max runs")

	preview := &cobra.Command{
		Use:   "preview",
		Short: "Validate a job body without creating (dry-run)",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			// Minimal safe preview: read-only SELECT shape is validated server-side.
			got, err := c.Post(ctx, "/api/scheduled-queries/preview", map[string]any{"query": "SELECT 1", "frequency": "manual"})
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	runNow := &cobra.Command{
		Use:   "run <id>",
		Short: "Execute a job now (action)",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			confirmDestructive("scheduled.run", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Post(ctx, "/api/scheduled-queries/"+args[0]+"/run", map[string]any{})
			if err != nil {
				failErr(err)
			}
			auditLine("scheduled.run", args[0], "scheduled_queries:run")
			render(resolved, got)
		},
	}
	remove := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a job (destructive)",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			confirmDestructive("scheduled.delete", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Delete(ctx, "/api/scheduled-queries/"+args[0])
			if err != nil {
				failErr(err)
			}
			auditLine("scheduled.delete", args[0], "scheduled_queries:delete")
			render(resolved, got)
		},
	}
	cmd.AddCommand(list, get, runs, preview, runNow, remove)
	return cmd
}

func newHealthCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "health", Short: "Data-health promises and incidents"}
	var connection string
	var limit int
	list := &cobra.Command{
		Use:   "list",
		Short: "List promises",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if connection != "" {
				q.Set("connectionId", connection)
			}
			got, err := c.Get(ctx, "/api/data-health", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	list.Flags().StringVar(&connection, "connection", "", "filter by connection ID")
	incidents := &cobra.Command{
		Use:   "incidents",
		Short: "List incidents",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if connection != "" {
				q.Set("connectionId", connection)
			}
			got, err := c.Get(ctx, "/api/data-health/incidents", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	incidents.Flags().StringVar(&connection, "connection", "", "filter by connection ID")
	timeline := &cobra.Command{
		Use:   "timeline <promiseId>",
		Short: "Show promise timeline",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			got, err := c.Get(ctx, "/api/data-health/"+args[0]+"/timeline", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	timeline.Flags().IntVar(&limit, "limit", 50, "max samples")
	run := &cobra.Command{
		Use:   "run <promiseId>",
		Short: "Execute checks now (action)",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			confirmDestructive("health.run", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Post(ctx, "/api/data-health/"+args[0]+"/run", map[string]any{})
			if err != nil {
				failErr(err)
			}
			auditLine("health.run", args[0], "data_health:run")
			render(resolved, got)
		},
	}
	ack := &cobra.Command{
		Use:   "ack <incidentId>",
		Short: "Acknowledge an incident",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			confirmDestructive("health.ack", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Post(ctx, "/api/data-health/incidents/"+args[0]+"/acknowledge", map[string]any{})
			if err != nil {
				failErr(err)
			}
			auditLine("health.ack", args[0], "data_health:edit")
			render(resolved, got)
		},
	}
	cmd.AddCommand(list, incidents, timeline, run, ack)
	return cmd
}

func printlnStderr(s string) {
	_, _ = os.Stderr.WriteString(s + "\n")
}
