package cli

import (
	"net/url"

	"github.com/spf13/cobra"
)

func newSavedCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "saved", Short: "Saved queries (metadata only, safe)"}
	var connection, name, query, desc string
	var public bool
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List saved queries",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if connection != "" {
				q.Set("connectionId", connection)
			}
			got, err := c.Get(ctx, "/api/saved-queries", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	list.Flags().StringVar(&connection, "connection", "", "filter by connection ID")
	list.Flags().IntVar(&limit, "limit", 50, "max rows (client-side)")

	get := &cobra.Command{
		Use:   "get <id>",
		Short: "Show one saved query",
		Args:  cobra.ExactArgs(1),
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
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			body := map[string]any{"name": name, "query": query, "description": desc, "isPublic": public}
			if connection != "" {
				body["connectionId"] = connection
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
		Args:  cobra.ExactArgs(1),
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
		Use:   "delete <id>",
		Short: "Delete a saved query",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
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
