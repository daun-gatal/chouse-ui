package cli

import (
	"net/url"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
	"github.com/daun-gatal/chouse-ui/cli/internal/safety"
)

var savedView = view("", "ID", "NAME", "CONNECTION=connectionName", "PUBLIC=isPublic", "UPDATED=updatedAt")

func (a *App) newSavedCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "saved",
		Aliases: []string{"saved-queries"},
		Short:   "Saved queries: list, show, run, create, delete",
		Long: `Named queries shared with the UI. run executes one through the
read-only path (saved writes are refused — use query --raw); delete asks
first (or needs --yes).`,
		Example: `  chouse saved list
  chouse saved run 3f2a… -o csv > out.csv
  chouse saved create --name daily-orders -f orders.sql`,
	}
	var limit int

	list := &cobra.Command{
		Use:     "list",
		Short:   "List saved queries (scoped to -c when given)",
		Example: `  chouse saved list -c prod`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/saved-queries", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(limitList(got, "", limit), savedView)
		}),
	}
	list.Flags().IntVar(&limit, "limit", 0, "max rows (0: all)")

	get := &cobra.Command{
		Use:     "get <id>",
		Short:   "Show one saved query and its SQL",
		Example: `  chouse saved get 3f2a… -o yaml`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/saved-queries/"+url.PathEscape(args[0]), nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}

	var name, desc, file string
	var stdin, public bool
	create := &cobra.Command{
		Use:   "create [sql]",
		Short: "Save a query (SQL as arguments, -f FILE or --stdin)",
		Example: `  chouse saved create --name six-seven "SELECT 6*7 AS x"
  chouse saved create --name daily -f daily.sql --public -c prod`,
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			sql, err := a.readSQL(file, stdin, args)
			if err != nil {
				return err
			}
			body := map[string]any{"name": name, "query": sql, "description": desc, "isPublic": public}
			if s.Cfg.Connection != "" {
				body["connectionId"] = s.Cfg.Connection
			}
			got, err := s.Client.Post(s.Ctx, "/api/saved-queries", body)
			if err != nil {
				return err
			}
			s.audit("saved.create", name, "saved_queries:create")
			return s.Print(got, output.View{})
		}),
	}
	create.Flags().StringVar(&name, "name", "", "name (required)")
	create.Flags().StringVar(&desc, "description", "", "description")
	create.Flags().BoolVar(&public, "public", false, "share with everyone")
	create.Flags().StringVarP(&file, "file", "f", "", "read SQL from a file (- for stdin)")
	create.Flags().BoolVar(&stdin, "stdin", false, "read SQL from stdin")
	_ = create.MarkFlagRequired("name")

	var runLimit int
	var outFile string
	run := &cobra.Command{
		Use:   "run <id>",
		Short: "Run a saved query (read-only)",
		Example: `  chouse saved run 3f2a…
  chouse saved run 3f2a… --out result.csv`,
		Args: cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			var saved struct {
				Query string `json:"query"`
			}
			if err := s.Client.DoJSON(s.Ctx, "GET", "/api/saved-queries/"+url.PathEscape(args[0]), nil, nil, &saved); err != nil {
				return err
			}
			if saved.Query == "" {
				return usagef("saved query %s has no SQL", args[0])
			}
			if safety.Classify(saved.Query) != safety.IntentRead {
				return usagef("saved query %s changes data; run it explicitly with chouse query --raw", args[0])
			}
			result, err := s.Client.QueryTableSelect(s.Ctx, saved.Query, runLimit)
			if err != nil {
				return err
			}
			return s.printResult(result, outFile)
		}),
	}
	run.Flags().IntVar(&runLimit, "limit", 1000, "max result rows")
	run.Flags().StringVar(&outFile, "out", "", "write the result to a file (.csv, .json, .yaml)")

	remove := &cobra.Command{
		Use:     "delete <id>",
		Short:   "Delete a saved query",
		Example: `  chouse saved delete 3f2a… --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("saved delete"); err != nil {
				return err
			}
			if err := s.confirm("delete saved query", args[0]); err != nil {
				return err
			}
			got, err := s.Client.Delete(s.Ctx, "/api/saved-queries/"+url.PathEscape(args[0]))
			if err != nil {
				return err
			}
			s.audit("saved.delete", args[0], "saved_queries:delete")
			return s.Print(got, output.View{})
		}),
	}

	cmd.AddCommand(list, get, create, run, remove)
	return cmd
}
