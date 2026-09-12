package cli

import (
	"net/url"
	"os"

	"github.com/spf13/cobra"
)

func newScheduledCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "scheduled", Short: "Scheduled queries (preview before create/run)"}
	var previewQuery string
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List jobs",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if resolved.Connection != "" {
				q.Set("connectionId", resolved.Connection)
			}
			got, err := c.Get(ctx, "/api/scheduled-queries", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

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
			if resolved.Connection == "" {
				fail(2, "preview needs a connection: pass --connection <id> (or -c / CHOUSE_CONNECTION)")
			}
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Post(ctx, "/api/scheduled-queries/preview", map[string]any{
				"query":        previewQuery,
				"frequency":    "manual",
				"connectionId": resolved.Connection,
			})
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	preview.Flags().StringVar(&previewQuery, "query", "SELECT 1", "SELECT to validate")
	runNow := &cobra.Command{
		Use:   "run <id>",
		Short: "Execute a job now (action)",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			rejectDryRun("scheduled run")
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
			rejectDryRun("scheduled delete")
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
	var limit int
	list := &cobra.Command{
		Use:   "list",
		Short: "List promises",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if resolved.Connection != "" {
				q.Set("connectionId", resolved.Connection)
			}
			got, err := c.Get(ctx, "/api/data-health", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	incidents := &cobra.Command{
		Use:   "incidents",
		Short: "List incidents",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if resolved.Connection != "" {
				q.Set("connectionId", resolved.Connection)
			}
			got, err := c.Get(ctx, "/api/data-health/incidents", q)
			if err != nil {
				failErr(err)
			}
			// The endpoint takes no limit param: truncate client-side so
			// --limit is honest (same pattern as saved list).
			if limit > 0 {
				if m, ok := got.(map[string]any); ok {
					if arr, ok := m["incidents"].([]any); ok && len(arr) > limit {
						m["incidents"] = arr[:limit]
					}
				}
			}
			render(resolved, got)
		},
	}
	incidents.Flags().IntVar(&limit, "limit", 50, "max rows (client-side)")
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
			rejectDryRun("health run")
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
			rejectDryRun("health ack")
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
