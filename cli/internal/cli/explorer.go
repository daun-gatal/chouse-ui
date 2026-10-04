package cli

import (
	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// tableArgs accepts "db.table" or "db table".
func tableArgs(args []string) (string, string, error) {
	if len(args) == 2 {
		return args[0], args[1], nil
	}
	return splitTable(args[0])
}

// flattenTables turns the explorer tree into one row per table (or one per
// empty database), filtered to db when given.
func flattenTables(tree any, db string) []any {
	dbs, _ := tree.([]any)
	rows := []any{}
	for _, d := range dbs {
		dbm, _ := d.(map[string]any)
		name, _ := dbm["name"].(string)
		if db != "" && name != db {
			continue
		}
		children, _ := dbm["children"].([]any)
		if len(children) == 0 {
			rows = append(rows, map[string]any{"database": name})
			continue
		}
		for _, t := range children {
			tm, _ := t.(map[string]any)
			rows = append(rows, map[string]any{"database": name, "table": tm["name"], "type": tm["type"], "engine": tm["engine"], "rows": tm["rows"], "size": tm["size"]})
		}
	}
	return rows
}

func (a *App) newTableCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "table",
		Aliases: []string{"tables", "explorer"},
		Short:   "Databases, tables, schemas and samples (read-only)",
		Long: `Explore what your token can see on the -c connection: databases
and tables, a table's columns and CREATE statement, and sample rows. All
read-only; run DDL with chouse query --raw.`,
		Example: `  chouse table list
  chouse table list analytics
  chouse table schema analytics.events
  chouse table sample analytics.events --limit 20`,
	}

	list := &cobra.Command{
		Use:   "list [database]",
		Short: "List tables (optionally in one database)",
		Example: `  chouse table list -c prod
  chouse table list analytics -o csv`,
		Args: cobra.MaximumNArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			tree, err := s.Client.ExplorerDatabases(s.Ctx)
			if err != nil {
				return err
			}
			db := ""
			if len(args) == 1 {
				db = args[0]
			}
			if s.out.Format == output.JSON || s.out.Format == output.YAML {
				return s.Print(flattenTables(tree, db), output.View{})
			}
			return s.Print(flattenTables(tree, db), output.View{Columns: []output.Column{
				{Header: "database"}, {Header: "table"}, {Header: "type"}, {Header: "engine"}, {Header: "rows"}, bytesCol("size", "size"),
			}})
		}),
	}

	schema := &cobra.Command{
		Use:   "schema <db.table | db table>",
		Short: "Show a table's engine, columns and CREATE statement",
		Example: `  chouse table schema analytics.events
  chouse table schema analytics.events -o json`,
		Args: cobra.RangeArgs(1, 2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			db, table, err := tableArgs(args)
			if err != nil {
				return err
			}
			got, err := s.Client.ExplorerTable(s.Ctx, db, table)
			if err != nil {
				return err
			}
			if s.out.Format == output.Table || s.out.Format == output.CSV {
				if columns, ok := got["columns"].([]any); ok {
					return s.Print(columns, output.View{Columns: cols("NAME", "TYPE", "DEFAULT=default_expression", "COMMENT")})
				}
			}
			return s.Print(got, output.View{})
		}),
	}

	var limit int
	sample := &cobra.Command{
		Use:   "sample <db.table | db table>",
		Short: "Show sample rows",
		Example: `  chouse table sample analytics.events --limit 20
  chouse table sample analytics.events -o csv`,
		Args: cobra.RangeArgs(1, 2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			db, table, err := tableArgs(args)
			if err != nil {
				return err
			}
			got, err := s.Client.ExplorerSample(s.Ctx, db, table, limit)
			if err != nil {
				return err
			}
			return s.printResult(got, "")
		}),
	}
	sample.Flags().IntVar(&limit, "limit", 20, "rows (max 1000)")

	cmd.AddCommand(list, schema, sample)
	return cmd
}
