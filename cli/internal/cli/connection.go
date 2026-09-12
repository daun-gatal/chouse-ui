package cli

import (
	"github.com/spf13/cobra"
)

func newConnectionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "connection",
		Aliases: []string{"conn", "connections"},
		Short:   "List, inspect, test, and select ClickHouse connections",
		Long: `Work with saved ClickHouse connections. List and inspect are
read-only; use verifies access; can-i checks what you may touch. Creating,
deleting, and ad-hoc credential tests stay in the browser. Pass -c (or set
it once via login) to scope commands to one connection.`,
		Example: `  chouse connection list
  chouse connection list --search prod --limit 5 -o json
  chouse connection can-i analytics events`,
	}
	var search string
	var limit int

	list := &cobra.Command{
		Use:   "list",
		Short: "List accessible connections (passwords never returned)",
		Long: `List the connections your token may see, with metadata only.
Filter by name/host substring; grab an id for -c, can-i, or use.`,
		Example: `  chouse connection list
  chouse connection list --search prod -o json`,
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
		Use:     "get <id>",
		Short:   "Show one connection (metadata only)",
		Long:    `Show one connection's metadata (host, port, database, flags). Passwords are never returned — that is also why create stays in the UI.`,
		Example: `  chouse connection get 57c2b5bf-0081-4880-9a05-057d1ec3b098 -o json`,
		Args:    cobra.ExactArgs(1),
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
		Long: `Dial a saved connection and report reachability plus the
databases visible through it. Read-only probe — nothing is stored or
changed. Without an id, ad-hoc credential tests stay in the browser.`,
		Example: `  chouse connection test 57c2b5bf-0081-4880-9a05-057d1ec3b098 -o json`,
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
		Long: `Verify access to a connection and print the correlation session.
Server-side state change, so it needs --yes outside a TTY like every other
mutation. Point later commands at it with -c.`,
		Example: `  chouse connection use 57c2b5bf-0081-4880-9a05-057d1ec3b098 --yes -o json`,
		Args:    cobra.ExactArgs(1),
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
		Long: `Ask the server whether your token may read a database (or a
specific table) on the scoped connection. Read-only preflight — run it
before scripting anything that assumes access.`,
		Example: `  chouse connection can-i analytics
  chouse connection can-i analytics events -c 57c2b5bf-0081-4880-9a05-057d1ec3b098 -o json`,
		Args: cobra.RangeArgs(1, 2),
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
		Long: `Creating a connection stores secrets, so it stays behind UI
review in v1. Use Connections → New connection in the browser, then come
back here to list, test, and use it.`,
		Example: `  chouse connection create
  # → hint pointing at Connections → New connection`,
		Run: func(_ *cobra.Command, _ []string) {
			uiOnly("connection create (stores secrets)", "Connections → New connection")
		},
	}
	remove := &cobra.Command{
		Use:   "delete",
		Short: "Delete a connection (UI-only in v1)",
		Long: `Deleting a connection affects every profile using it, so it
stays behind UI review in v1. Use Connections → Delete in the browser.`,
		Example: `  chouse connection delete
  # → hint pointing at Connections → Delete`,
		Run: func(_ *cobra.Command, _ []string) {
			uiOnly("connection delete", "Connections → Delete")
		},
	}

	cmd.AddCommand(list, get, test, use, cani, create, remove)
	return cmd
}
