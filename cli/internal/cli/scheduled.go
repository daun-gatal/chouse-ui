package cli

import (
	"net/url"
	"os"

	"github.com/spf13/cobra"
)

func newScheduledCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "scheduled",
		Short: "Scheduled queries (preview before create/run)",
		Long: `Inspect scheduled query jobs, their run history, and validate
new job bodies before creating them. Listing and previewing are free;
run and delete are actions and need --yes.`,
		Example: `  chouse scheduled list
  chouse scheduled preview --connection 57c2b5bf-0081-4880-9a05-057d1ec3b098 --query "SELECT 1"
  chouse scheduled run job_abc123 --yes`,
	}
	var previewQuery string
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List jobs",
		Long:  `List scheduled query jobs, optionally scoped with -c. Pair with runs or preview before touching anything.`,
		Example: `  chouse scheduled list
  chouse scheduled list -o json`,
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
		Use:     "get <id>",
		Short:   "Show one job",
		Long:    `Show one scheduled job's definition (query, frequency, connection) without running it.`,
		Example: `  chouse scheduled get job_abc123 -o json`,
		Args:    cobra.ExactArgs(1),
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
		Long:  `Show a job's past runs (newest first, capped at --limit) to check health before running it again.`,
		Example: `  chouse scheduled runs job_abc123 --limit 5
  chouse scheduled runs job_abc123 -o json`,
		Args: cobra.ExactArgs(1),
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
		Long: `Validate a SELECT against a connection without creating any job:
checks access, read-only-ness, and tokens. Needs a connection via
--connection, -c, or CHOUSE_CONNECTION. Always safe.`,
		Example: `  chouse scheduled preview --connection 57c2b5bf-0081-4880-9a05-057d1ec3b098 --query "SELECT 1"
  chouse scheduled preview -c 57c2b5bf-0081-4880-9a05-057d1ec3b098 --query "SELECT count() FROM analytics.events" -o json`,
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
		Long: `Execute a scheduled job immediately, outside its timetable. An
action like any mutation — needs --yes outside a TTY. Check runs first.`,
		Example: `  chouse scheduled runs job_abc123 --limit 3
  chouse scheduled run job_abc123 --yes`,
		Args: cobra.ExactArgs(1),
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
		Use:     "delete <id>",
		Short:   "Delete a job (destructive)",
		Long:    `Delete a scheduled job permanently. Destructive — needs --yes outside a TTY. Double-check runs first.`,
		Example: `  chouse scheduled delete job_abc123 --yes`,
		Args:    cobra.ExactArgs(1),
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
	cmd := &cobra.Command{
		Use:   "health",
		Short: "Data-health promises and incidents",
		Long: `Data-health promises, their incidents, and timelines — plus the
actions to re-run checks or acknowledge incidents. Reads are free; run and
ack are actions needing --yes.`,
		Example: `  chouse health list
  chouse health incidents --limit 5 -o json
  chouse health ack inc_abc123 --yes`,
	}
	var limit int
	list := &cobra.Command{
		Use:   "list",
		Short: "List promises",
		Long:  `List data-health promises and their current state. Start here, then drill into incidents or a timeline.`,
		Example: `  chouse health list
  chouse health list -o json`,
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
		Long:  `List data-health incidents, newest first, capped at --limit (client-side). Acknowledge one with health ack.`,
		Example: `  chouse health incidents --limit 5
  chouse health incidents -o json`,
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
		Long:  `Show one promise's check timeline (newest samples first, capped at --limit). Read-only history for post-mortems.`,
		Example: `  chouse health timeline prom_abc123 --limit 10
  chouse health timeline prom_abc123 -o json`,
		Args: cobra.ExactArgs(1),
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
		Use:     "run <promiseId>",
		Short:   "Execute checks now (action)",
		Long:    `Execute a promise's checks immediately instead of waiting for the schedule. An action — needs --yes outside a TTY.`,
		Example: `  chouse health run prom_abc123 --yes`,
		Args:    cobra.ExactArgs(1),
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
		Use:     "ack <incidentId>",
		Short:   "Acknowledge an incident",
		Long:    `Acknowledge an incident so on-call knows it's handled. An action — needs --yes outside a TTY.`,
		Example: `  chouse health ack inc_abc123 --yes`,
		Args:    cobra.ExactArgs(1),
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
