package cli

import (
	"github.com/spf13/cobra"
)

func newConnectionCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "connection", Aliases: []string{"conn", "connections"}, Short: "List, inspect, test, and select ClickHouse connections"}
	var search string
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List accessible connections (passwords never returned)",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.ConnectionsList(ctx, search, limit)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	list.Flags().StringVar(&search, "search", "", "filter by name/host")
	list.Flags().IntVar(&limit, "limit", 50, "max rows")

	get := &cobra.Command{
		Use:   "get <id>",
		Short: "Show one connection (metadata only)",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/rbac/connections/"+args[0], nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	test := &cobra.Command{
		Use:   "test <id>",
		Short: "Probe a saved connection without saving anything",
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			if len(args) == 0 {
				uiOnly("ad-hoc connection test with raw credentials", "Connections → Test")
			}
			got, err := c.Post(ctx, "/api/rbac/connections/"+args[0]+"/test", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	use := &cobra.Command{
		Use:   "use <id>",
		Short: "Verify access to a connection (prints correlation session)",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			rejectDryRun("connection use")
			confirmDestructive("connection.use", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.ConnectionUse(ctx, args[0])
			if err != nil {
				failErr(err)
			}
			auditLine("connection.use", args[0], "connection access")
			render(resolved, got)
		},
	}

	cani := &cobra.Command{
		Use:   "can-i <database> [table]",
		Short: "Check data-access for a database/table",
		Args:  cobra.RangeArgs(1, 2),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			body := map[string]any{"database": args[0], "accessType": "read"}
			if len(args) == 2 {
				body["table"] = args[1]
			}
			if resolved.Connection != "" {
				body["connectionId"] = resolved.Connection
			}
			got, err := c.CanAccess(ctx, body)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	create := &cobra.Command{
		Use:   "create",
		Short: "Create a connection (UI-only in v1)",
		Run: func(_ *cobra.Command, _ []string) {
			uiOnly("connection create (stores secrets)", "Connections → New connection")
		},
	}
	remove := &cobra.Command{
		Use:   "delete",
		Short: "Delete a connection (UI-only in v1)",
		Run: func(_ *cobra.Command, _ []string) {
			uiOnly("connection delete", "Connections → Delete")
		},
	}

	cmd.AddCommand(list, get, test, use, cani, create, remove)
	return cmd
}
