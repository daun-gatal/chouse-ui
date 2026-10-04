package cli

import (
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

var connectionColumns = cols("ID", "NAME", "HOST", "PORT", "DATABASE", "DEFAULT=isDefault", "ACTIVE=isActive")

func (a *App) newConnectionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "connection",
		Aliases: []string{"conn", "connections"},
		Short:   "ClickHouse connections you can use",
		Long: `List, inspect and check the ClickHouse connections your token can
use. Every command takes -c with a connection name or id; set a default with
chouse config set connection NAME. Creating and deleting connections stores
or removes credentials, so it stays in the UI (Admin › Connections).`,
		Example: `  chouse connection list
  chouse connection get prod
  chouse connection can-i analytics events -c prod`,
	}

	var search string
	var limit int
	list := &cobra.Command{
		Use:   "list",
		Short: "List the connections you can use (no passwords)",
		Example: `  chouse connection list
  chouse connection list --search prod -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			var conns []any
			if err := s.Client.DoJSON(s.Ctx, "GET", "/api/rbac/connections/my", nil, nil, &conns); err != nil {
				return err
			}
			if needle := strings.ToLower(strings.TrimSpace(search)); needle != "" {
				filtered := conns[:0]
				for _, c := range conns {
					m, _ := c.(map[string]any)
					name, _ := m["name"].(string)
					host, _ := m["host"].(string)
					if strings.Contains(strings.ToLower(name+" "+host), needle) {
						filtered = append(filtered, c)
					}
				}
				conns = filtered
			}
			return s.Print(limitList(conns, "", limit), output.View{Columns: connectionColumns})
		}),
	}
	list.Flags().StringVar(&search, "search", "", "filter by name or host")
	list.Flags().IntVar(&limit, "limit", 0, "max rows (0: all)")

	get := &cobra.Command{
		Use:     "get <name|id>",
		Short:   "Show one connection (no password)",
		Example: `  chouse connection get prod -o yaml`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			id, err := s.connectionID(args[0])
			if err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/rbac/connections/"+url.PathEscape(id), nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}

	test := &cobra.Command{
		Use:   "test <name|id>",
		Short: "Check that a connection is reachable",
		Long: `Dial a saved connection and report reachability and the server
version. Nothing is stored or changed. Testing ad-hoc credentials stays in
the UI.`,
		Example: `  chouse connection test prod`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			id, err := s.connectionID(args[0])
			if err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, "/api/rbac/connections/"+url.PathEscape(id)+"/test", nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}

	cani := &cobra.Command{
		Use:   "can-i <database> [table]",
		Short: "Check whether you may read a database or table",
		Long: `Ask the server whether your token may read a database, or one
table, on the -c connection. Run it before scripting anything that assumes
access.`,
		Example: `  chouse connection can-i analytics -c prod
  chouse connection can-i analytics events -c prod -o json`,
		Args: cobra.RangeArgs(1, 2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			body := map[string]any{"database": args[0], "accessType": "read"}
			if len(args) == 2 {
				body["table"] = args[1]
			}
			if s.Cfg.Connection != "" {
				body["connectionId"] = s.Cfg.Connection
			}
			got, err := s.Client.CanAccess(s.Ctx, body)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}

	cmd.AddCommand(list, get, test, cani)
	return cmd
}

// connectionID resolves a connection argument (name or id) the same way -c is.
func (s *Session) connectionID(ref string) (string, error) {
	saved, savedClient := s.Cfg.Connection, s.Client.ConnectionID
	s.Cfg.Connection = ref
	err := s.resolveConnection()
	id := s.Cfg.Connection
	s.Cfg.Connection, s.Client.ConnectionID = saved, savedClient
	return id, err
}
