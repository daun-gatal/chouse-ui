package cli

import (
	"encoding/json"
	"io"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// dashboardFormat is the export format apply takes (server: spec.ts).
const dashboardFormat = "chouse.dashboard/v1"

// dashboardRanges are the values of `dashboard run-panel --range`.
var dashboardRanges = []string{"15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"}

var dashboardView = view("", "ID", "TITLE", "PANELS=panelCount", "OWNER=ownerName", "PINNED=pinned", "UPDATED=updatedAt")

var dashboardPanelsView = view("panels", "ID", "TITLE", "CHART=viz.type", "UNIT=viz.unit", "WIDTH=width", "FLEET=fleet")

// dashboardExport is the part of an export apply reads before sending it whole.
type dashboardExport struct {
	Format    string          `json:"format"`
	ID        *string         `json:"id"`
	Dashboard json.RawMessage `json:"dashboard"`
}

// readExport reads an export from FILE or - (stdin) and checks its format.
func (a *App) readExport(file string) (dashboardExport, map[string]any, error) {
	var raw []byte
	var err error
	if file == "-" {
		raw, err = io.ReadAll(a.In)
	} else {
		raw, err = os.ReadFile(file)
	}
	if err != nil {
		return dashboardExport{}, nil, usagef("%v", err)
	}
	var doc dashboardExport
	if err := json.Unmarshal(raw, &doc); err != nil {
		return dashboardExport{}, nil, usagef("%s is not JSON: %v", file, err)
	}
	if doc.Format != dashboardFormat {
		return dashboardExport{}, nil, usagef("%s is not a dashboard export (format must be %q; get one with chouse dashboard export)", file, dashboardFormat)
	}
	if len(doc.Dashboard) == 0 {
		return dashboardExport{}, nil, usagef("%s has no dashboard", file)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return dashboardExport{}, nil, usagef("%s is not a JSON object: %v", file, err)
	}
	return doc, body, nil
}

// parseVars turns repeated --var name=value into the request's values.
func parseVars(pairs []string) (map[string]string, error) {
	values := map[string]string{}
	for _, pair := range pairs {
		name, value, ok := strings.Cut(pair, "=")
		if !ok || name == "" {
			return nil, usagef("--var must be name=value, got %q", pair)
		}
		values[name] = value
	}
	return values, nil
}

func (a *App) newDashboardCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "dashboard",
		Aliases: []string{"dashboards"},
		Short:   "Dashboards: list, show, run a panel, export, apply, delete",
		Long: `Custom dashboards (ADR 0021) as code. export writes a dashboard as JSON;
apply creates a dashboard from that JSON, or updates the dashboard its id
names so it matches the file exactly (panels left out are removed with
their alerts). run-panel runs one panel's read-only query with your own
data access. delete asks first (or needs --yes).`,
		Example: `  chouse dashboard list
  chouse dashboard export 7c1e… > orders.json
  chouse dashboard apply -f orders.json
  chouse dashboard run-panel 7c1e… 2b9d… --range 24h --var db=shop`,
	}

	list := &cobra.Command{
		Use:     "list",
		Short:   "List the dashboards you may view",
		Example: `  chouse dashboard list -o json`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/dashboards", nil)
			if err != nil {
				return err
			}
			return s.Print(got, dashboardView)
		}),
	}

	get := &cobra.Command{
		Use:     "get <id>",
		Short:   "Show a dashboard's panels (-o json for everything)",
		Example: `  chouse dashboard get 7c1e…`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/dashboards/"+url.PathEscape(args[0]), nil)
			if err != nil {
				return err
			}
			return s.Print(got, dashboardPanelsView)
		}),
	}

	var outFile string
	export := &cobra.Command{
		Use:   "export <id>",
		Short: "Write a dashboard as JSON (the format apply takes)",
		Example: `  chouse dashboard export 7c1e… > orders.json
  chouse dashboard export 7c1e… --out orders.json`,
		Args: cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			var doc map[string]any
			if err := s.Client.DoJSON(s.Ctx, "GET", "/api/dashboards/"+url.PathEscape(args[0])+"/export", nil, nil, &doc); err != nil {
				return err
			}
			pretty, err := json.MarshalIndent(doc, "", "  ")
			if err != nil {
				return err
			}
			pretty = append(pretty, '\n')
			if outFile == "" {
				_, err = s.Out.Write(pretty)
				return err
			}
			if err := os.WriteFile(outFile, pretty, 0o644); err != nil {
				return usagef("%v", err)
			}
			s.notef("Wrote %s", outFile)
			return nil
		}),
	}
	export.Flags().StringVar(&outFile, "out", "", "write to this file instead of stdout")

	var applyFile string
	apply := &cobra.Command{
		Use:   "apply -f FILE",
		Short: "Create or update a dashboard from an export",
		Long: `With "id": null in the file, a new dashboard is created (yours, with new
panel ids). With an id, that dashboard is updated to match the file: panels
keep their ids, panels missing from the file are removed together with
their alerts. The server validates every panel; nothing is partly applied.`,
		Example: `  chouse dashboard apply -f orders.json
  chouse dashboard export 7c1e… | chouse dashboard apply -f -`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if applyFile == "" {
				return usagef("give the export with -f FILE (or -f - for stdin)")
			}
			if err := a.rejectDryRun("dashboard apply"); err != nil {
				return err
			}
			doc, body, err := a.readExport(applyFile)
			if err != nil {
				return err
			}
			if doc.ID == nil || *doc.ID == "" {
				got, err := s.Client.Post(s.Ctx, "/api/dashboards/import", body)
				if err != nil {
					return err
				}
				s.audit("dashboard.import", applyFile, "dashboards:edit")
				return s.Print(got, dashboardPanelsView)
			}
			id := *doc.ID
			var current struct {
				Dashboard struct {
					Version int `json:"version"`
				} `json:"dashboard"`
			}
			if err := s.Client.DoJSON(s.Ctx, "GET", "/api/dashboards/"+url.PathEscape(id), nil, nil, &current); err != nil {
				return err
			}
			var got any
			update := map[string]any{"version": current.Dashboard.Version, "dashboard": doc.Dashboard}
			if err := s.Client.DoJSON(s.Ctx, "PUT", "/api/dashboards/"+url.PathEscape(id), nil, update, &got); err != nil {
				return err
			}
			s.audit("dashboard.update", id, "dashboards:edit")
			return s.Print(got, dashboardPanelsView)
		}),
	}
	apply.Flags().StringVarP(&applyFile, "file", "f", "", "the export to apply (- for stdin)")

	var runRange, runConnection string
	var runVars []string
	runPanel := &cobra.Command{
		Use:   "run-panel <dashboardId> <panelId>",
		Short: "Run one panel's read-only query",
		Example: `  chouse dashboard run-panel 7c1e… 2b9d… --range 24h
  chouse dashboard run-panel 7c1e… 2b9d… --var db=shop -o csv`,
		Args: cobra.ExactArgs(2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if !oneOf(runRange, dashboardRanges) {
				return usagef("--range must be one of %s", strings.Join(dashboardRanges, ", "))
			}
			values, err := parseVars(runVars)
			if err != nil {
				return err
			}
			body := map[string]any{"range": map[string]any{"kind": "relative", "value": runRange}, "values": values, "connectionId": nil}
			if runConnection != "" {
				body["connectionId"] = runConnection
			}
			got, err := s.Client.Post(s.Ctx, "/api/dashboards/"+url.PathEscape(args[0])+"/panels/"+url.PathEscape(args[1])+"/run", body)
			if err != nil {
				return err
			}
			if m, ok := got.(map[string]any); ok && m["kind"] == "fleet" {
				return s.Print(got, view("connections", "CONNECTION=connectionName", "OK=ok", "ERROR=error"))
			}
			return s.Print(got, output.View{List: "data.rows"})
		}),
	}
	runPanel.Flags().StringVar(&runRange, "range", "1h", "how far back: "+strings.Join(dashboardRanges, ", "))
	runPanel.Flags().StringArrayVar(&runVars, "var", nil, "a variable value as name=value (repeatable)")
	runPanel.Flags().StringVar(&runConnection, "connection-id", "", "run on this connection id instead of the dashboard's")

	remove := &cobra.Command{
		Use:     "delete <id>",
		Short:   "Delete a dashboard with its panels and alerts",
		Example: `  chouse dashboard delete 7c1e… --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("dashboard delete"); err != nil {
				return err
			}
			if err := s.confirm("delete dashboard", args[0]); err != nil {
				return err
			}
			got, err := s.Client.Delete(s.Ctx, "/api/dashboards/"+url.PathEscape(args[0]))
			if err != nil {
				return err
			}
			s.audit("dashboard.delete", args[0], "dashboards:delete")
			return s.Print(got, output.View{})
		}),
	}

	cmd.AddCommand(list, get, export, apply, runPanel, remove)
	return cmd
}
