package cli

import (
	"github.com/spf13/cobra"
)

func newTableCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "table",
		Aliases: []string{"explorer"},
		Short:   "Databases, schemas, and samples (reads); DDL stays guarded",
		Long: `Explore databases, table schemas, and row samples — all reads.
Schema changes stay guarded: create/drop either point at the UI or need
explicit SQL with --yes. Prefer table sample over SELECT * when eyeballing
data.`,
		Example: `  chouse table list
  chouse table schema analytics events
  chouse table sample analytics events --limit 20 -o json`,
	}
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List databases and tables",
		Long:  `List every database and table visible to your token on the scoped connection. Start here when you don't know what's available.`,
		Example: `  chouse table list
  chouse table list -c 57c2b5bf-0081-4880-9a05-057d1ec3b098 -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.ExplorerDatabases(ctx)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	schema := &cobra.Command{
		Use:   "schema <db> <table>",
		Short: "Show engine, columns, and CREATE statement",
		Long:  `Show a table's engine, columns, and full CREATE statement. Read-only — the safe way to learn a schema before writing queries.`,
		Example: `  chouse table schema analytics events
  chouse table schema system numbers -o json`,
		Args: cobra.ExactArgs(2),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.ExplorerTable(ctx, args[0], args[1])
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	sample := &cobra.Command{
		Use:   "sample <db> <table>",
		Short: "Sample rows (read-only)",
		Long:  `Fetch up to --limit sample rows (max 1000). The quickest way to eyeball data without writing a query.`,
		Example: `  chouse table sample analytics events --limit 20
  chouse table sample system numbers --limit 2 -o json`,
		Args: cobra.ExactArgs(2),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.ExplorerSample(ctx, args[0], args[1], limit)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	sample.Flags().IntVar(&limit, "limit", 100, "rows (max 1000)")

	create := &cobra.Command{
		Use:   "create",
		Short: "Create database/table (guarded; prefer UI for schema design)",
		Long: `Schema design stays in the browser, so this command only prints
the pointer. For scripted DDL, use explicit SQL: chouse query --raw --yes.`,
		Example: `  chouse explorer create
  # → hint pointing at Explorer → New database/table`,
		Run: func(_ *cobra.Command, _ []string) {
			uiOnly("interactive DDL builder", "Explorer → New database/table (CLI accepts explicit SQL via: chouse query --raw --yes)")
		},
	}
	drop := &cobra.Command{
		Use:   "drop <db> [table]",
		Short: "Drop a database or table (destructive)",
		Long: `Preview or drop a database (one arg) or a single table (two
args). --dry-run prints the plan without touching anything and needs no
confirmation; the real thing only runs as explicit SQL with --yes.`,
		Example: `  chouse table drop analytics events --dry-run
  chouse query --raw --yes "DROP TABLE analytics.events"`,
		Args: cobra.RangeArgs(1, 2),
		Run: func(_ *cobra.Command, args []string) {
			target := args[0]
			if len(args) == 2 {
				target += "." + args[1]
			}
			// Preview first: fully offline plan, never needs --yes.
			if flagDryRun {
				resolved := mustConfig()
				render(resolved, map[string]any{"dry_run": true, "action": "drop", "target": target})
				return
			}
			confirmDestructive("drop", target)
			uiOnly("drop "+target, "Explorer → Drop (CLI executes explicit SQL via: chouse query --raw --yes \"DROP TABLE "+target+"\")")
		},
	}

	cmd.AddCommand(list, schema, sample, create, drop)
	return cmd
}
