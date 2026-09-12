package cli

import (
	"net/url"

	"github.com/spf13/cobra"
)

func newSavedCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "saved",
		Short: "Saved queries (metadata only, safe)",
		Long: `Store, list, and re-run named queries. Saving is metadata-only;
running reuses the read-only query path, and deleting one needs --yes like
any destructive action.`,
		Example: `  chouse saved list
  chouse saved create --name six-seven --query "SELECT 6*7 AS x"
  chouse saved run abc123 -o json
  chouse saved delete abc123 --yes`,
	}
	var name, query, desc string
	var public bool
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List saved queries",
		Long:  `List saved queries visible to your token, optionally filtered by connection. Pair with run to execute one read-only.`,
		Example: `  chouse saved list
  chouse saved list --limit 5 -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if resolved.Connection != "" {
				q.Set("connectionId", resolved.Connection)
			}
			got, err := c.Get(ctx, "/api/saved-queries", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	list.Flags().IntVar(&limit, "limit", 50, "max rows (client-side)")

	get := &cobra.Command{
		Use:     "get <id>",
		Short:   "Show one saved query",
		Long:    `Show one saved query's metadata and SQL without executing it. Use run to execute it read-only.`,
		Example: `  chouse saved get abc123 -o json`,
		Args:    cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/saved-queries/"+args[0], nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	create := &cobra.Command{
		Use:   "create",
		Short: "Create a saved query",
		Long: `Save a named query (name and SQL required). Metadata-only and
instantly listable; mark it --public to share with the team, or scope it
with --connection.`,
		Example: `  chouse saved create --name six-seven --query "SELECT 6*7 AS x"
  chouse saved create --name ev --query "SELECT * FROM analytics.events LIMIT 5" --desc "recent events" -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			body := map[string]any{"name": name, "query": query, "description": desc, "isPublic": public}
			if resolved.Connection != "" {
				body["connectionId"] = resolved.Connection
			}
			got, err := c.Post(ctx, "/api/saved-queries", body)
			if err != nil {
				failErr(err)
			}
			auditLine("saved.create", name, "saved_queries:create")
			render(resolved, got)
		},
	}
	create.Flags().StringVar(&name, "name", "", "name (required)")
	create.Flags().StringVar(&query, "query", "", "SQL (required)")
	create.Flags().StringVar(&desc, "desc", "", "description")
	create.Flags().BoolVar(&public, "public", false, "share with team")
	_ = create.MarkFlagRequired("name")
	_ = create.MarkFlagRequired("query")

	run := &cobra.Command{
		Use:   "run <id>",
		Short: "Fetch a saved query and execute it read-only",
		Long:  `Fetch a saved query by id and execute it through the read-only query path. Writes stored in a saved query are refused — use query --raw for those.`,
		Example: `  chouse saved run abc123
  chouse saved run abc123 -o json`,
		Args: cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			saved, err := c.Get(ctx, "/api/saved-queries/"+args[0], nil)
			if err != nil {
				failErr(err)
			}
			sql := extractSavedSQL(saved)
			if sql == "" {
				fail(2, "saved query has no SQL")
			}
			got, err := c.QueryTableSelect(ctx, sql, 1000)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	remove := &cobra.Command{
		Use:     "delete <id>",
		Short:   "Delete a saved query",
		Long:    `Delete a saved query by id. Destructive, so it needs --yes outside a TTY like every other mutation.`,
		Example: `  chouse saved delete abc123 --yes`,
		Args:    cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			rejectDryRun("saved delete")
			confirmDestructive("saved.delete", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Delete(ctx, "/api/saved-queries/"+args[0])
			if err != nil {
				failErr(err)
			}
			auditLine("saved.delete", args[0], "saved_queries:delete")
			render(resolved, got)
		},
	}

	cmd.AddCommand(list, get, create, run, remove)
	return cmd
}

func extractSavedSQL(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	if q, ok := m["query"].(string); ok {
		return q
	}
	if d, ok := m["data"].(map[string]any); ok {
		if q, ok := d["query"].(string); ok {
			return q
		}
	}
	return ""
}
