package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// dashboardFormats are the export formats apply takes (server: spec.ts). The
// server converts a format 1 export from before CHouse 3.16.
var dashboardFormats = []string{"chouse.dashboard/v2", "chouse.dashboard/v1"}

// dashboardRanges are the values of `--range`, with their length in seconds.
var dashboardRanges = []string{"15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"}

var rangeSeconds = map[string]int64{"15m": 900, "1h": 3_600, "3h": 10_800, "6h": 21_600, "12h": 43_200, "24h": 86_400, "2d": 172_800, "7d": 604_800, "30d": 2_592_000}

var dashboardView = output.View{Columns: slices.Concat(
	cols("ID", "TITLE", "PANELS=panelCount"),
	[]output.Column{scopeCol()},
	cols("OWNER=ownerName", "PINNED=pinned", "UPDATED=updatedAt"),
)}

// scopeCol shows the connections a dashboard is assigned to: "all", or the
// ones you may use by name and a count of the others.
func scopeCol() output.Column {
	return output.Column{Header: "CONNECTIONS", Path: "scope", Format: func(v any) string {
		scope, ok := v.(map[string]any)
		if !ok || scope["kind"] == "any" {
			return "all"
		}
		var names []string
		if list, ok := scope["connections"].([]any); ok {
			for _, c := range list {
				if m, ok := c.(map[string]any); ok {
					names = append(names, fmt.Sprint(m["name"]))
				}
			}
		}
		if hidden, ok := scope["hidden"].(float64); ok && hidden > 0 {
			names = append(names, fmt.Sprintf("+%d more", int(hidden)))
		}
		return strings.Join(names, ", ")
	}}
}

// sizeCol shows a panel's place on the 24-column canvas as WxH (columns × rows).
func sizeCol() output.Column {
	return output.Column{Header: "SIZE", Path: "layout", Format: func(v any) string {
		layout, ok := v.(map[string]any)
		if !ok {
			return ""
		}
		return fmt.Sprintf("%vx%v", layout["w"], layout["h"])
	}}
}

var dashboardPanelsView = output.View{List: "panels", Columns: slices.Concat(
	cols("ID", "KIND", "TITLE", "CHART=viz.type", "UNIT=viz.unit"),
	[]output.Column{sizeCol()},
	cols("FLEET=fleet"),
)}

var dashboardVersionsView = view("", "VERSION", "SOURCE", "SAVED_BY=savedByName", "SAVED_AT=savedAt")

var snapshotsView = view("", "ID", "NAME", "FROM=range.from", "TO=range.to", "BY=createdByName", "SIZE=sizeBytes", "EXPIRES=expiresAt")

// dashboardExport is the part of an export apply reads before sending it whole.
type dashboardExport struct {
	Format    string          `json:"format"`
	ID        *string         `json:"id"`
	Dashboard json.RawMessage `json:"dashboard"`
}

// readFile reads FILE, or stdin for "-".
func (a *App) readFile(file string) ([]byte, error) {
	var raw []byte
	var err error
	if file == "-" {
		raw, err = io.ReadAll(a.In)
	} else {
		raw, err = os.ReadFile(file)
	}
	if err != nil {
		return nil, usagef("%v", err)
	}
	return raw, nil
}

// readExport reads an export from FILE or - (stdin) and checks its format.
func (a *App) readExport(file string) (dashboardExport, map[string]any, error) {
	raw, err := a.readFile(file)
	if err != nil {
		return dashboardExport{}, nil, err
	}
	var doc dashboardExport
	if err := json.Unmarshal(raw, &doc); err != nil {
		return dashboardExport{}, nil, usagef("%s is not JSON: %v", file, err)
	}
	if !slices.Contains(dashboardFormats, doc.Format) {
		return dashboardExport{}, nil, usagef("%s is not a dashboard export (format must be %s; get one with chouse dashboard export, or use import-grafana for a Grafana dashboard)", file, strings.Join(dashboardFormats, " or "))
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

// parseVars turns repeated --var name=value into values by name; a name given
// more than once collects a list (for a multi-value variable).
func parseVars(pairs []string) (map[string][]string, error) {
	values := map[string][]string{}
	for _, pair := range pairs {
		name, value, ok := strings.Cut(pair, "=")
		if !ok || name == "" {
			return nil, usagef("--var must be name=value, got %q", pair)
		}
		values[name] = append(values[name], value)
	}
	return values, nil
}

// requestValues shapes --var values for the dashboard's variables: a list for
// a multi-value variable, one string for any other.
func (s *Session) requestValues(dashboardID string, vars map[string][]string) (map[string]any, error) {
	values := map[string]any{}
	if len(vars) == 0 {
		return values, nil
	}
	var detail struct {
		Dashboard struct {
			Variables []struct {
				Name string `json:"name"`
				Kind string `json:"kind"`
			} `json:"variables"`
		} `json:"dashboard"`
	}
	if err := s.Client.DoJSON(s.Ctx, "GET", "/api/dashboards/"+url.PathEscape(dashboardID), nil, nil, &detail); err != nil {
		return nil, err
	}
	kinds := map[string]string{}
	for _, v := range detail.Dashboard.Variables {
		kinds[v.Name] = v.Kind
	}
	for name, list := range vars {
		kind, ok := kinds[name]
		switch {
		case !ok:
			return nil, usagef("the dashboard has no variable %q", name)
		case kind == "multi":
			values[name] = list
		case len(list) > 1:
			return nil, usagef("%s takes one value; --var %s was given %d times", name, name, len(list))
		default:
			values[name] = list[0]
		}
	}
	return values, nil
}

func (a *App) newDashboardCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "dashboard",
		Aliases: []string{"dashboards"},
		Short:   "Dashboards: list, show, run a panel, export, apply, versions, snapshots, Grafana import",
		Long: `Custom dashboards (ADR 0021, ADR 0023) as code. export writes a dashboard as
JSON; apply creates a dashboard from that JSON, or updates the dashboard its
id names so it matches the file exactly (panels left out are removed with
their alerts). run-panel runs one panel's read-only query with your own data
access. versions and restore read and roll back its history; snapshot freezes
its results for a range. import-grafana converts a Grafana dashboard. delete
and restore ask first (or need --yes).`,
		Example: `  chouse dashboard list
  chouse dashboard export 7c1e… > orders.json
  chouse dashboard apply -f orders.json
  chouse dashboard run-panel 7c1e… 2b9d… --range 24h --var db=shop
  chouse dashboard import-grafana -f grafana.json --apply`,
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
			return s.writeJSON(doc, outFile)
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
their alerts. The server validates every panel; nothing is partly applied.
An export from before CHouse 3.16 (chouse.dashboard/v1) is converted.`,
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
			version, err := s.dashboardVersion(id)
			if err != nil {
				return err
			}
			var got any
			update := map[string]any{"version": version, "dashboard": doc.Dashboard}
			if err := s.Client.DoJSON(s.Ctx, "PUT", "/api/dashboards/"+url.PathEscape(id), nil, update, &got); err != nil {
				return err
			}
			s.audit("dashboard.update", id, "dashboards:edit")
			return s.Print(got, dashboardPanelsView)
		}),
	}
	apply.Flags().StringVarP(&applyFile, "file", "f", "", "the export to apply (- for stdin)")

	var runRange string
	var runVars []string
	runPanel := &cobra.Command{
		Use:   "run-panel <dashboardId> <panelId>",
		Short: "Run one panel's read-only query",
		Example: `  chouse dashboard run-panel 7c1e… 2b9d… -c prod --range 24h
  chouse dashboard run-panel 7c1e… 2b9d… --var db=shop -o csv
  chouse dashboard run-panel 7c1e… 2b9d… --var status=ok --var status=err`,
		Args: cobra.ExactArgs(2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if !oneOf(runRange, dashboardRanges) {
				return usagef("--range must be one of %s", strings.Join(dashboardRanges, ", "))
			}
			vars, err := parseVars(runVars)
			if err != nil {
				return err
			}
			values, err := s.requestValues(args[0], vars)
			if err != nil {
				return err
			}
			// A panel runs on the -c connection (sent as X-Connection-Id); a fleet panel on all of them.
			body := map[string]any{"range": map[string]any{"kind": "relative", "value": runRange}, "values": values}
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
	runPanel.Flags().StringArrayVar(&runVars, "var", nil, "a variable value as name=value (repeatable; repeat a name for a multi-value variable)")

	versions := &cobra.Command{
		Use:     "versions <id>",
		Short:   "List a dashboard's last 50 saves",
		Example: `  chouse dashboard versions 7c1e…`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/dashboards/"+url.PathEscape(args[0])+"/versions", nil)
			if err != nil {
				return err
			}
			return s.Print(got, dashboardVersionsView)
		}),
	}

	restore := &cobra.Command{
		Use:   "restore <id> <version>",
		Short: "Save an old version as the newest one",
		Long: `Restoring saves the old version's document as a new version, so it can be
undone by restoring the version before it. Panels the old version does not
have are removed with their alerts; restore lists those alerts and asks
first (or needs --yes).`,
		Example: `  chouse dashboard restore 7c1e… 12 --yes`,
		Args:    cobra.ExactArgs(2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			id := args[0]
			version, err := strconv.Atoi(args[1])
			if err != nil || version < 1 {
				return usagef("version must be a positive whole number, got %q", args[1])
			}
			if err := a.rejectDryRun("dashboard restore"); err != nil {
				return err
			}
			base := "/api/dashboards/" + url.PathEscape(id) + "/versions/" + strconv.Itoa(version)
			var preview struct {
				RemovedPanels int `json:"removedPanels"`
				RemovedAlerts []struct {
					Name string `json:"name"`
				} `json:"removedAlerts"`
			}
			if err := s.Client.DoJSON(s.Ctx, "GET", base+"/restore-preview", nil, nil, &preview); err != nil {
				return err
			}
			if preview.RemovedPanels > 0 {
				names := make([]string, 0, len(preview.RemovedAlerts))
				for _, alert := range preview.RemovedAlerts {
					names = append(names, alert.Name)
				}
				note := fmt.Sprintf("Restoring removes %d panel(s)", preview.RemovedPanels)
				if len(names) > 0 {
					note += " and these alerts: " + strings.Join(names, ", ")
				}
				s.notef("%s", note)
			}
			if err := s.confirm("restore dashboard", fmt.Sprintf("%s to version %d", id, version)); err != nil {
				return err
			}
			current, err := s.dashboardVersion(id)
			if err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, base+"/restore", map[string]any{"currentVersion": current})
			if err != nil {
				return err
			}
			s.audit("dashboard.restore", id, "dashboards:edit")
			return s.Print(got, dashboardPanelsView)
		}),
	}

	cmd.AddCommand(list, get, export, apply, runPanel, versions, restore, a.newDashboardSnapshotCmd(), a.newDashboardGrafanaCmd(), a.newDashboardDeleteCmd())
	return cmd
}

// dashboardVersion reads a dashboard's current version, which a save must name.
func (s *Session) dashboardVersion(id string) (int, error) {
	var current struct {
		Dashboard struct {
			Version int `json:"version"`
		} `json:"dashboard"`
	}
	if err := s.Client.DoJSON(s.Ctx, "GET", "/api/dashboards/"+url.PathEscape(id), nil, nil, &current); err != nil {
		return 0, err
	}
	return current.Dashboard.Version, nil
}

// writeJSON writes indented JSON to stdout, or to file when one is given.
func (s *Session) writeJSON(doc any, file string) error {
	pretty, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	pretty = append(pretty, '\n')
	if file == "" {
		_, err = s.Out.Write(pretty)
		return err
	}
	if err := os.WriteFile(file, pretty, 0o644); err != nil {
		return usagef("%v", err)
	}
	s.notef("Wrote %s", file)
	return nil
}

func (a *App) newDashboardSnapshotCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "snapshot",
		Short: "Freeze a dashboard's results for a range, and read them back",
		Long: `A snapshot stores every chart panel's result for a range ending now, run as
you on the -c connection (at most 10 MiB). You, and the shared roles you name
with --role, can open it until it expires; whoever opens it still only sees
what their own access allows.`,
		Example: `  chouse dashboard snapshot create 7c1e… --name "Incident 42" --range 6h -c prod
  chouse dashboard snapshot list 7c1e…
  chouse dashboard snapshot get 7c1e… 9a0f… --out incident-42.json`,
	}

	var name, snapRange string
	var vars, roles []string
	var days int
	create := &cobra.Command{
		Use:     "create <dashboardId> --name NAME",
		Short:   "Take a snapshot",
		Example: `  chouse dashboard snapshot create 7c1e… --name "Incident 42" --range 6h -c prod --role team-b-role-id --expires-days 90`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if strings.TrimSpace(name) == "" {
				return usagef("give the snapshot a --name")
			}
			if !oneOf(snapRange, dashboardRanges) {
				return usagef("--range must be one of %s", strings.Join(dashboardRanges, ", "))
			}
			if days < 1 || days > 365 {
				return usagef("--expires-days must be 1 to 365")
			}
			if err := s.requireConnection("dashboard snapshot create"); err != nil {
				return err
			}
			if err := a.rejectDryRun("dashboard snapshot create"); err != nil {
				return err
			}
			parsed, err := parseVars(vars)
			if err != nil {
				return err
			}
			values, err := s.requestValues(args[0], parsed)
			if err != nil {
				return err
			}
			to := time.Now().Unix()
			if roles == nil {
				roles = []string{}
			}
			body := map[string]any{"name": name, "from": to - rangeSeconds[snapRange], "to": to, "values": values, "roleIds": roles, "expiresInDays": days, "incidentId": nil}
			got, err := s.Client.Post(s.Ctx, "/api/dashboards/"+url.PathEscape(args[0])+"/snapshots", body)
			if err != nil {
				return err
			}
			s.audit("dashboard.snapshot_create", args[0], "dashboards:view")
			return s.Print(got, output.View{})
		}),
	}
	create.Flags().StringVar(&name, "name", "", "the snapshot's name")
	create.Flags().StringVar(&snapRange, "range", "1h", "the range to freeze, ending now: "+strings.Join(dashboardRanges, ", "))
	create.Flags().StringArrayVar(&vars, "var", nil, "a variable value as name=value (repeatable)")
	create.Flags().StringArrayVar(&roles, "role", nil, "a role id the dashboard is shared with that may open it (repeatable)")
	create.Flags().IntVar(&days, "expires-days", 30, "days until it expires (1 to 365)")

	list := &cobra.Command{
		Use:     "list <dashboardId>",
		Short:   "List the snapshots you may open",
		Example: `  chouse dashboard snapshot list 7c1e…`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/dashboards/"+url.PathEscape(args[0])+"/snapshots", nil)
			if err != nil {
				return err
			}
			return s.Print(got, snapshotsView)
		}),
	}

	var outFile string
	get := &cobra.Command{
		Use:     "get <dashboardId> <snapshotId>",
		Short:   "Write a snapshot (document and results) as JSON",
		Example: `  chouse dashboard snapshot get 7c1e… 9a0f… --out incident-42.json`,
		Args:    cobra.ExactArgs(2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			var doc map[string]any
			if err := s.Client.DoJSON(s.Ctx, "GET", "/api/dashboards/"+url.PathEscape(args[0])+"/snapshots/"+url.PathEscape(args[1]), nil, nil, &doc); err != nil {
				return err
			}
			return s.writeJSON(doc, outFile)
		}),
	}
	get.Flags().StringVar(&outFile, "out", "", "write to this file instead of stdout")

	cmd.AddCommand(create, list, get)
	return cmd
}

var grafanaPanelsView = view("panels", "STATUS", "TITLE", "TYPE=grafanaType", "REASON=reason", "CHANGES=changes")

func (a *App) newDashboardGrafanaCmd() *cobra.Command {
	var file string
	var allConnections, doApply bool
	cmd := &cobra.Command{
		Use:   "import-grafana -f FILE",
		Short: "Convert a Grafana dashboard, and with --apply import it",
		Long: `Prints what converts: each Grafana panel is ready, changed (with what
changed) or skipped (with why). Only ClickHouse panels convert. Nothing is
saved without --apply, which imports the convertible panels like apply -f.
The dashboard is assigned to the -c connection, or to every connection with
--all-connections.`,
		Example: `  chouse dashboard import-grafana -f grafana.json -c prod
  chouse dashboard import-grafana -f grafana.json -c prod --apply`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if file == "" {
				return usagef("give the Grafana dashboard JSON with -f FILE (or -f - for stdin)")
			}
			if !allConnections {
				if err := s.requireConnection("dashboard import-grafana"); err != nil {
					return err
				}
			}
			if doApply {
				if err := a.rejectDryRun("dashboard import-grafana --apply"); err != nil {
					return err
				}
			}
			raw, err := a.readFile(file)
			if err != nil {
				return err
			}
			var grafana any
			if err := json.Unmarshal(raw, &grafana); err != nil {
				return usagef("%s is not JSON: %v", file, err)
			}
			scope := map[string]any{"kind": "any"}
			if !allConnections {
				scope = map[string]any{"kind": "only", "connectionIds": []string{s.Cfg.Connection}}
			}
			var preview struct {
				Dashboard map[string]any   `json:"dashboard"`
				Panels    []map[string]any `json:"panels"`
				Notes     []string         `json:"notes"`
			}
			var shown any
			if err := s.Client.DoJSON(s.Ctx, "POST", "/api/dashboards/import/grafana", nil, map[string]any{"grafana": grafana, "connectionScope": scope}, &shown); err != nil {
				return err
			}
			again, _ := json.Marshal(shown)
			if err := json.Unmarshal(again, &preview); err != nil {
				return err
			}
			for _, note := range preview.Notes {
				s.notef("%s", note)
			}
			if !doApply {
				return s.Print(shown, grafanaPanelsView)
			}
			panels, _ := preview.Dashboard["panels"].([]any)
			if len(panels) == 0 {
				return usagef("nothing in %s converts, so nothing was imported", file)
			}
			got, err := s.Client.Post(s.Ctx, "/api/dashboards/import", map[string]any{"format": dashboardFormats[0], "id": nil, "dashboard": preview.Dashboard})
			if err != nil {
				return err
			}
			s.audit("dashboard.import", file, "dashboards:edit")
			return s.Print(got, dashboardPanelsView)
		}),
	}
	cmd.Flags().StringVarP(&file, "file", "f", "", "the Grafana dashboard JSON (- for stdin)")
	cmd.Flags().BoolVar(&allConnections, "all-connections", false, "assign the dashboard to every connection instead of -c")
	cmd.Flags().BoolVar(&doApply, "apply", false, "import the convertible panels")
	return cmd
}

func (a *App) newDashboardDeleteCmd() *cobra.Command {
	return &cobra.Command{
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
}
