package cli

import (
	"net/url"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// getCmd is a read-only GET of path (built from the arguments) rendered
// with v.
func (a *App) getCmd(use, short, example string, nargs cobra.PositionalArgs, path func(args []string) string, v output.View) *cobra.Command {
	return &cobra.Command{
		Use:     use,
		Short:   short,
		Example: example,
		Args:    nargs,
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.Get(s.Ctx, path(args), nil)
			if err != nil {
				return err
			}
			return s.Print(got, v)
		}),
	}
}

// postAction is a confirmed POST to path (built from the first argument).
func (a *App) postAction(use, short, example, action, permission string, path func(id string) string) *cobra.Command {
	return &cobra.Command{
		Use:     use,
		Short:   short,
		Example: example,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun(action); err != nil {
				return err
			}
			if err := s.confirm(action, args[0]); err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, path(args[0]), map[string]any{})
			if err != nil {
				return err
			}
			s.audit(action, args[0], permission)
			return s.Print(got, output.View{})
		}),
	}
}

func esc(s string) string { return url.PathEscape(s) }

func (a *App) newScheduledCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "scheduled",
		Aliases: []string{"jobs"},
		Short:   "Scheduled queries: jobs, runs, run now",
		Long: `Scheduled query jobs and their runs. preview checks a SELECT
without creating anything; run and delete ask first (or need --yes).
Creating and editing jobs stays in the UI.`,
		Example: `  chouse scheduled list -c prod
  chouse scheduled runs 4d2e… --limit 5
  chouse scheduled run 4d2e… --yes`,
	}
	jobs := view("jobs", "ID", "NAME", "ENABLED", "FREQUENCY", "MODE=outputMode", "LAST RUN=lastRunAt")

	list := &cobra.Command{
		Use:     "list",
		Short:   "List jobs (scoped to -c when given)",
		Example: `  chouse scheduled list -c prod`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/scheduled-queries", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, jobs)
		}),
	}
	get := a.getCmd("get <id>", "Show one job", "  chouse scheduled get 4d2e… -o yaml", cobra.ExactArgs(1),
		func(args []string) string { return "/api/scheduled-queries/" + esc(args[0]) }, output.View{})

	var limit int
	runs := &cobra.Command{
		Use:     "runs <id>",
		Short:   "A job's runs, newest first",
		Example: `  chouse scheduled runs 4d2e… --limit 5`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			q := url.Values{}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			got, err := s.Client.Get(s.Ctx, "/api/scheduled-queries/"+esc(args[0])+"/runs", q)
			if err != nil {
				return err
			}
			return s.Print(got, view("runs", "ID", "STATUS", "TRIGGER", "STARTED=startedAt", "MS=durationMs", "ROWS=rowCount", "MESSAGE"))
		}),
	}
	runs.Flags().IntVar(&limit, "limit", 20, "max runs")

	var previewSQL, previewFile string
	preview := &cobra.Command{
		Use:   "preview",
		Short: "Check a SELECT as a job body without creating anything",
		Example: `  chouse scheduled preview -c prod --query "SELECT count() FROM events"
  chouse scheduled preview -c prod -f job.sql`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if err := s.requireConnection("scheduled preview"); err != nil {
				return err
			}
			var args []string
			if previewSQL != "" {
				args = []string{previewSQL}
			}
			sql, err := a.readSQL(previewFile, false, args)
			if err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, "/api/scheduled-queries/preview", map[string]any{"query": sql, "frequency": "manual", "connectionId": s.Cfg.Connection})
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	preview.Flags().StringVar(&previewSQL, "query", "", "SELECT to check")
	preview.Flags().StringVarP(&previewFile, "file", "f", "", "read the SELECT from a file (- for stdin)")

	run := a.postAction("run <id>", "Run a job now", "  chouse scheduled run 4d2e… --yes", "run scheduled job", "scheduled_queries:run",
		func(id string) string { return "/api/scheduled-queries/" + esc(id) + "/run" })

	remove := &cobra.Command{
		Use:     "delete <id>",
		Short:   "Delete a job",
		Example: `  chouse scheduled delete 4d2e… --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("scheduled delete"); err != nil {
				return err
			}
			if err := s.confirm("delete scheduled job", args[0]); err != nil {
				return err
			}
			got, err := s.Client.Delete(s.Ctx, "/api/scheduled-queries/"+esc(args[0]))
			if err != nil {
				return err
			}
			s.audit("scheduled.delete", args[0], "scheduled_queries:delete")
			return s.Print(got, output.View{})
		}),
	}
	cmd.AddCommand(list, get, runs, preview, run, remove)
	return cmd
}

func (a *App) newHealthCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "health",
		Short: "Data health: promises, incidents, dataset trust",
		Long: `Data health promises and their incidents, one table's trust state,
and the actions to re-run checks or acknowledge an incident (both ask first,
or need --yes).`,
		Example: `  chouse health list -c prod
  chouse health incidents
  chouse health dataset shop.orders -c prod
  chouse health ack 9a1f… --yes`,
	}
	list := &cobra.Command{
		Use:     "list",
		Short:   "List promises (scoped to -c when given)",
		Example: `  chouse health list -c prod`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/data-health", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, view("promises", "ID", "NAME", "STATUS", "CRITICALITY", "DATABASE=databaseName", "TABLE=tableName", "ENABLED"))
		}),
	}
	var limit int
	incidents := &cobra.Command{
		Use:     "incidents",
		Short:   "Data health incidents, newest first",
		Example: `  chouse health incidents --limit 10`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/data-health/incidents", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(limitList(got, "incidents", limit), view("incidents", "ID", "STATUS", "SEVERITY", "KIND", "OPENED=openedAt", "SUMMARY"))
		}),
	}
	incidents.Flags().IntVar(&limit, "limit", 50, "max rows")

	var timelineLimit int
	timeline := &cobra.Command{
		Use:     "timeline <promiseId>",
		Short:   "A promise's check history",
		Example: `  chouse health timeline 2b7c… --limit 10`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			q := url.Values{}
			if timelineLimit > 0 {
				q.Set("limit", itoa(timelineLimit))
			}
			got, err := s.Client.Get(s.Ctx, "/api/data-health/"+esc(args[0])+"/timeline", q)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	timeline.Flags().IntVar(&timelineLimit, "limit", 50, "max samples")

	dataset := &cobra.Command{
		Use:   "dataset <database.table>",
		Short: "One table's trust state, freshness and open incidents",
		Long: `How far to trust one table right now: trust state, freshness,
volume baseline, open incidents, owners and recent writers.`,
		Example: `  chouse health dataset shop.orders -c prod`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			db, table, err := splitTable(args[0])
			if err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/observe/datasets/"+esc(db)+"/"+esc(table), s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}

	run := a.postAction("run <promiseId>", "Run a promise's checks now", "  chouse health run 2b7c… --yes", "run data health checks", "data_health:run",
		func(id string) string { return "/api/data-health/" + esc(id) + "/run" })
	ack := a.postAction("ack <incidentId>", "Acknowledge an incident", "  chouse health ack 9a1f… --yes", "acknowledge incident", "data_health:edit",
		func(id string) string { return "/api/data-health/incidents/" + esc(id) + "/acknowledge" })

	cmd.AddCommand(list, incidents, timeline, dataset, run, ack)
	return cmd
}
