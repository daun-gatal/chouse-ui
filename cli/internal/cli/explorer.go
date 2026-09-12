package cli

import (
	"github.com/spf13/cobra"
)

func newTableCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "table", Aliases: []string{"explorer"}, Short: "Databases, schemas, and samples (reads); DDL stays guarded"}
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List databases and tables",
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
		Args:  cobra.ExactArgs(2),
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
		Args:  cobra.ExactArgs(2),
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
		Run: func(_ *cobra.Command, _ []string) {
			confirmDestructive("ddl-create", "database/table")
			uiOnly("interactive DDL builder", "Explorer → New database/table (CLI accepts explicit SQL via: chouse query --raw --yes)")
		},
	}
	drop := &cobra.Command{
		Use:   "drop <db> [table]",
		Short: "Drop a database or table (destructive)",
		Args:  cobra.RangeArgs(1, 2),
		Run: func(_ *cobra.Command, args []string) {
			target := args[0]
			if len(args) == 2 {
				target += "." + args[1]
			}
			confirmDestructive("drop", target)
			if flagDryRun {
				_, resolved := mustClient(true)
				render(resolved, map[string]any{"dry_run": true, "action": "drop", "target": target})
				return
			}
			uiOnly("drop "+target, "Explorer → Drop (CLI executes explicit SQL via: chouse query --raw --yes \"DROP TABLE "+target+"\")")
		},
	}

	cmd.AddCommand(list, schema, sample, create, drop)
	return cmd
}
