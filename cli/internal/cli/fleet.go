package cli

import (
	"net/url"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

func (a *App) newFleetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fleet",
		Short: "Every connection at once: health snapshots and history",
		Long: `The latest health snapshot of every connection you can see, their
history, and fixed server-side metrics (no ad-hoc SQL).`,
		Example: `  chouse fleet list
  chouse fleet history --metric summary --from 2026-10-01T00:00:00Z`,
	}
	list := &cobra.Command{
		Use:     "list",
		Short:   "Latest snapshot per connection",
		Example: `  chouse fleet list`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/fleet/snapshots", nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	var from, to, metric string
	var limit int
	history := &cobra.Command{
		Use:     "history",
		Short:   "Snapshot history in an RFC3339 window",
		Example: `  chouse fleet history --metric summary --limit 50`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			q := url.Values{}
			for k, v := range map[string]string{"from": from, "to": to, "metric": metric} {
				if v != "" {
					q.Set(k, v)
				}
			}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			got, err := s.Client.Get(s.Ctx, "/api/fleet/history", q)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	history.Flags().StringVar(&from, "from", "", "RFC3339 start")
	history.Flags().StringVar(&to, "to", "", "RFC3339 end")
	history.Flags().StringVar(&metric, "metric", "summary", "metric name")
	history.Flags().IntVar(&limit, "limit", 100, "max rows")

	query := &cobra.Command{
		Use:     "query <metric>",
		Short:   "One fixed server-side metric for the -c connection",
		Example: `  chouse fleet query summary -c prod`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := s.requireConnection("fleet query"); err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, "/api/fleet/query", map[string]any{"connectionId": s.Cfg.Connection, "metric": args[0]})
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	cmd.AddCommand(list, history, query)
	return cmd
}

func (a *App) newDoctorCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "doctor",
		Short: "Chouse AI Doctor: fleet health reports",
		Long: `Read past Doctor reports for free. A new scan calls the AI model
(LLM cost) and stores a report, so it asks first (or needs --yes). Advisory
only — it never changes data.`,
		Example: `  chouse doctor reports
  chouse doctor get 7c1e…
  chouse doctor scan --hours 24 --yes`,
	}
	var model string
	var hours int
	var connections []string
	scan := &cobra.Command{
		Use:     "scan",
		Short:   "Run a scan (LLM cost)",
		Example: `  chouse doctor scan --hours 12 --yes`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if err := a.rejectDryRun("doctor scan"); err != nil {
				return err
			}
			s.notef("note: a scan calls the AI model (LLM cost) and stores a report")
			if err := s.confirm("run Doctor scan", "fleet"); err != nil {
				return err
			}
			body := map[string]any{"hours": hours}
			if model != "" {
				body["modelId"] = model
			}
			if len(connections) > 0 {
				body["connectionIds"] = connections
			}
			got, err := s.Client.Post(s.Ctx, "/api/fleet/doctor/scan", body)
			if err != nil {
				return err
			}
			s.audit("doctor.scan", "fleet", "doctor:run")
			return s.Print(got, output.View{})
		}),
	}
	scan.Flags().StringVar(&model, "model", "", "AI model id (default: the server's)")
	scan.Flags().IntVar(&hours, "hours", 24, "look back 1-72 hours")
	scan.Flags().StringSliceVar(&connections, "connections", nil, "only these connection ids")

	reports := &cobra.Command{
		Use:     "reports",
		Short:   "List reports",
		Example: `  chouse doctor reports`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/fleet/doctor/reports", nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	get := &cobra.Command{
		Use:     "get <reportId>",
		Short:   "Show one report",
		Example: `  chouse doctor get 7c1e… -o yaml`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/fleet/doctor/reports/"+url.PathEscape(args[0]), nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	schedule := &cobra.Command{
		Use:     "schedule",
		Short:   "Show the scan schedule",
		Example: `  chouse doctor schedule`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/fleet/doctor/schedule", nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	cmd.AddCommand(scan, reports, get, schedule)
	return cmd
}
