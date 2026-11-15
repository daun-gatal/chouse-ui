package cli

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

var (
	runsAsColumns = cols("CONNECTION=connectionName", "KIND=kind", "RUNS AS=runsAs.name", "VIA=runsAs.type", "STATE=state")
	linkColumns   = cols("ACCOUNT=accountName", "EMAIL=accountEmail", "CLICKHOUSE USER=clickhouseUser", "STATE=state", "REASON=reason", "ID=id")
)

// identityCommands are the connection-identity commands (ADR 0033): what the
// caller's statements run as, a connection's kind and health, and the links
// between accounts and ClickHouse users on a personal connection.
func (a *App) identityCommands() []*cobra.Command {
	runsAs := &cobra.Command{
		Use:   "runs-as [name|id]",
		Short: "Which ClickHouse user or role your statements run with",
		Long: `For each connection you can use, show the ClickHouse identity your
statements run with: the connection's login (a shared login), a ClickHouse
role (a role ceiling), or your own linked ClickHouse user (a personal
connection), and whether it is usable now.

"ready" means the identity is in place; ClickHouse grants and your
permissions still decide each statement. Any other state names what is
missing, and DETAIL (in -o json or yaml) says who can fix it. A personal
connection also lists the statement forms it refuses. Needs server 3.18 or
newer.`,
		Example: `  chouse connection runs-as
  chouse connection runs-as prod -o yaml`,
		Args: cobra.MaximumNArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			var got struct {
				Identities []any `json:"identities"`
			}
			if err := s.Client.DoJSON(s.Ctx, "GET", "/api/rbac/connections/identity/mine", nil, nil, &got); err != nil {
				return err
			}
			if len(args) == 0 {
				return s.Print(got.Identities, output.View{Columns: runsAsColumns})
			}
			// Matched here, not through -c: someone whose link is waiting is not admitted to the connection yet.
			var matches []map[string]any
			for _, entry := range got.Identities {
				m, _ := entry.(map[string]any)
				id, _ := m["connectionId"].(string)
				name, _ := m["connectionName"].(string)
				if id == args[0] {
					return s.Print(m, output.View{})
				}
				if strings.EqualFold(name, args[0]) {
					matches = append(matches, m)
				}
			}
			if len(matches) == 1 {
				return s.Print(matches[0], output.View{})
			}
			if len(matches) > 1 {
				return usagef("%d connections are named %q: pass the connection's id", len(matches), args[0])
			}
			return usagef("no connection named %q among the ones you can use or hold a link on (chouse connection runs-as lists them)", args[0])
		}),
	}

	identity := &cobra.Command{
		Use:   "identity",
		Short: "A connection's kind, roles and health (super admin)",
		Long: `How a connection reaches ClickHouse: its kind (shared login, role
ceiling or personal), the roles it names, whether its login passes CHouse
UI's checks, and which kinds its server can run. Switching the kind and
editing the role map store credentials and decide what ClickHouse lets every
account do, so they stay in the UI (Admin › Connections › ClickHouse login).
Only a super admin, with a token that has no scopes. Needs server 3.18 or
newer.`,
		Example: `  chouse connection identity get prod
  chouse connection identity recheck prod`,
	}
	identity.AddCommand(
		&cobra.Command{
			Use:     "get <name|id>",
			Short:   "Show the kind, roles, health and which kinds the server can run",
			Example: `  chouse connection identity get prod -o yaml`,
			Args:    cobra.ExactArgs(1),
			RunE: a.action(needAuth, func(s *Session, args []string) error {
				id, err := s.connectionID(args[0])
				if err != nil {
					return err
				}
				got, err := s.Client.Get(s.Ctx, "/api/rbac/connections/"+url.PathEscape(id)+"/identity", nil)
				if err != nil {
					return err
				}
				return s.Print(got, output.View{})
			}),
		},
		&cobra.Command{
			Use:   "recheck <name|id>",
			Short: "Run the login's checks now and store the result",
			Long: `Run CHouse UI's checks on a connection's stored login now instead
of waiting for the five-minute round. A failing result makes the connection
refuse every request until a later check passes; a passing one lets people
back in. Nothing about the login is changed. Exits with 5 when the login fails
its checks.`,
			Example: `  chouse connection identity recheck prod`,
			Args:    cobra.ExactArgs(1),
			RunE: a.action(needAuth, func(s *Session, args []string) error {
				if err := a.rejectDryRun("connection identity recheck"); err != nil {
					return err
				}
				id, err := s.connectionID(args[0])
				if err != nil {
					return err
				}
				got, err := s.Client.Post(s.Ctx, "/api/rbac/connections/"+url.PathEscape(id)+"/identity/recheck", map[string]any{})
				if err != nil {
					return err
				}
				s.audit("connection.identity_recheck", args[0], "super_admin")
				if err := s.Print(got, output.View{}); err != nil {
					return err
				}
				// A failing result is this command's answer, and a script must see it without parsing the output.
				if verdict, isMap := pick(got, "verdict").(map[string]any); isMap && verdict["ok"] == false {
					reason, _ := verdict["reason"].(string)
					return &ExitError{Code: api.ExitServer, Err: fmt.Errorf("the login failed its checks, and the connection refuses requests until a check passes: %s", reason)}
				}
				return nil
			}),
		},
	)

	links := &cobra.Command{
		Use:   "links",
		Short: "Links between accounts and ClickHouse users (super admin)",
		Long: `On a personal connection each account's statements run as the
ClickHouse user it is linked to. These commands list a connection's links,
print the GRANT statements for your ClickHouse administrator, add a link,
re-check and remove one. Confirming or removing a suspended link stays in the UI: a
suspension means the person behind the account may have changed, and lifting
it is a person's decision. Only a super admin, with a token that has no
scopes. Needs server 3.18 or newer.`,
		Example: `  chouse connection links list prod
  chouse connection links add prod --account ann.lee --user alice
  chouse connection links grants prod | clickhouse-client --multiquery`,
	}

	var accountFlag, userFlag string
	add := &cobra.Command{
		Use:   "add <connection>",
		Short: "Link an account to a ClickHouse user",
		Long: `Link one CHouse account to one ClickHouse user on a connection.
--account takes the account's username, email or id; it must match exactly
one account. The link is active once ClickHouse lets the connection act as
the user; until then it waits, and "links grants" prints the statement to
run. CHouse UI stores no password for the ClickHouse user.`,
		Example: `  chouse connection links add prod --account ann.lee --user alice --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("connection links add"); err != nil {
				return err
			}
			if strings.TrimSpace(accountFlag) == "" || strings.TrimSpace(userFlag) == "" {
				return usagef("--account and --user are required")
			}
			id, err := s.connectionID(args[0])
			if err != nil {
				return err
			}
			userID, name, err := s.accountID(accountFlag)
			if err != nil {
				return err
			}
			target := fmt.Sprintf("%s -> %s on %s", name, userFlag, args[0])
			if err := s.confirm("link account to ClickHouse user", target); err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, "/api/rbac/clickhouse-bindings/connection/"+url.PathEscape(id), map[string]any{"userId": userID, "clickhouseUser": strings.TrimSpace(userFlag)})
			if err != nil {
				return err
			}
			s.audit("binding.created", target, "super_admin")
			return s.Print(pick(got, "binding"), output.View{})
		}),
	}
	add.Flags().StringVar(&accountFlag, "account", "", "the CHouse account: username, email or id")
	add.Flags().StringVar(&userFlag, "user", "", "the ClickHouse user its statements run as")

	var revokes bool
	grants := &cobra.Command{
		Use:   "grants <connection>",
		Short: "Print the GRANT statements for your ClickHouse administrator",
		Long: `Print one GRANT per link that is waiting for it, as SQL on stdout.
CHouse UI cannot run these: hand them to a ClickHouse administrator, or pipe
them to a client that connects as one. With --revokes, print instead the
REVOKE for each ClickHouse user the connection may still act as although no
link uses it. Nothing is printed when there is nothing to run. Always SQL,
whatever -o says.`,
		Example: `  chouse connection links grants prod
  chouse connection links grants prod --revokes`,
		Args: cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			listing, err := s.links(args[0])
			if err != nil {
				return err
			}
			var lines []string
			if revokes {
				unbound, _ := listing["unbound"].([]any)
				for _, entry := range unbound {
					m, _ := entry.(map[string]any)
					if line, ok := m["revoke"].(string); ok {
						lines = append(lines, line)
					}
				}
			} else {
				raw, _ := listing["grants"].([]any)
				for _, entry := range raw {
					if line, ok := entry.(string); ok {
						lines = append(lines, line)
					}
				}
			}
			if len(lines) == 0 {
				s.notef("Nothing to run.")
				return nil
			}
			// A placeholder means the connection names no impersonation role yet: not SQL anyone should run.
			for _, line := range lines {
				if strings.Contains(line, "<") {
					return usagef("the connection has no impersonation role yet, so there is no statement to run: switch it to a personal connection in the UI first")
				}
			}
			_, err = fmt.Fprintln(s.Out, strings.Join(lines, "\n"))
			return err
		}),
	}
	grants.Flags().BoolVar(&revokes, "revokes", false, "print the REVOKE statements for ClickHouse users no link uses")

	links.AddCommand(
		&cobra.Command{
			Use:     "list <connection>",
			Short:   "List a connection's links and their state",
			Example: `  chouse connection links list prod -o json`,
			Args:    cobra.ExactArgs(1),
			RunE: a.action(needAuth, func(s *Session, args []string) error {
				listing, err := s.links(args[0])
				if err != nil {
					return err
				}
				if support, ok := listing["personalSupport"].(map[string]any); ok && support["state"] == "unavailable" {
					s.notef("This connection's server cannot be a personal connection, so its links cannot be used: %v", support["reason"])
				}
				// Machine formats get everything (grants, unlinked users, counts); a table shows the links.
				if s.out.Format == output.Table || s.out.Format == output.CSV {
					return s.Print(listing["bindings"], output.View{Columns: linkColumns})
				}
				return s.Print(listing, output.View{})
			}),
		},
		add,
		grants,
		&cobra.Command{
			Use:   "check <connection> <account|link-id>",
			Short: "Re-check one link against ClickHouse now",
			Long: `Run a link's checks now: a waiting link becomes active once the
grant is there. A suspended or disabled link is not changed by a check.`,
			Example: `  chouse connection links check prod ann.lee`,
			Args:    cobra.ExactArgs(2),
			RunE: a.action(needAuth, func(s *Session, args []string) error {
				if err := a.rejectDryRun("connection links check"); err != nil {
					return err
				}
				linkID, _, err := s.linkID(args[0], args[1])
				if err != nil {
					return err
				}
				got, err := s.Client.Post(s.Ctx, "/api/rbac/clickhouse-bindings/"+url.PathEscape(linkID)+"/recheck", map[string]any{})
				if err != nil {
					return err
				}
				return s.Print(pick(got, "binding"), output.View{})
			}),
		},
		&cobra.Command{
			Use:   "remove <connection> <account|link-id>",
			Short: "Remove a link",
			Long: `Remove a link: the account's statements are refused on the
connection from its next request. The GRANT in ClickHouse stays; "links
grants --revokes" prints the statement that takes it away.`,
			Example: `  chouse connection links remove prod ann.lee --yes`,
			Args:    cobra.ExactArgs(2),
			RunE: a.action(needAuth, func(s *Session, args []string) error {
				if err := a.rejectDryRun("connection links remove"); err != nil {
					return err
				}
				linkID, label, err := s.linkID(args[0], args[1])
				if err != nil {
					return err
				}
				if err := s.confirm("remove link", label+" on "+args[0]); err != nil {
					return err
				}
				if _, err := s.Client.Delete(s.Ctx, "/api/rbac/clickhouse-bindings/"+url.PathEscape(linkID)); err != nil {
					return err
				}
				s.audit("binding.removed", label+" on "+args[0], "super_admin")
				s.notef("Removed.")
				return nil
			}),
		},
	)
	return []*cobra.Command{runsAs, identity, links}
}

// pick returns value[key] when value is an object that has it, else value.
func pick(value any, key string) any {
	if m, ok := value.(map[string]any); ok {
		if inner, found := m[key]; found {
			return inner
		}
	}
	return value
}

// links reads a connection's links, grant script and readiness.
func (s *Session) links(connection string) (map[string]any, error) {
	id, err := s.connectionID(connection)
	if err != nil {
		return nil, err
	}
	var listing map[string]any
	if err := s.Client.DoJSON(s.Ctx, "GET", "/api/rbac/clickhouse-bindings/connection/"+url.PathEscape(id), nil, nil, &listing); err != nil {
		return nil, err
	}
	return listing, nil
}

// linkID resolves a link on a connection by its id, or by its account's id,
// username or email. More than one match, or none, is a usage error.
func (s *Session) linkID(connection, ref string) (id, label string, err error) {
	listing, err := s.links(connection)
	if err != nil {
		return "", "", err
	}
	bindings, _ := listing["bindings"].([]any)
	var found []map[string]any
	for _, entry := range bindings {
		m, _ := entry.(map[string]any)
		for _, key := range []string{"id", "userId", "accountName", "accountEmail"} {
			if value, _ := m[key].(string); value != "" && strings.EqualFold(value, ref) {
				found = append(found, m)
				break
			}
		}
	}
	if len(found) != 1 {
		return "", "", usagef("%d links on %s match %q (chouse connection links list %s shows them)", len(found), connection, ref, connection)
	}
	id, _ = found[0]["id"].(string)
	account, _ := found[0]["accountName"].(string)
	user, _ := found[0]["clickhouseUser"].(string)
	return id, account + " -> " + user, nil
}

// accountID resolves an account by id, username or email to exactly one
// account. A search that also matches other accounts by substring is narrowed
// to exact matches, so "ann" never picks "joanna".
func (s *Session) accountID(ref string) (id, name string, err error) {
	ref = strings.TrimSpace(ref)
	if uuidPattern.MatchString(ref) {
		// The search below matches names and emails only.
		var one struct {
			User map[string]any `json:"user"`
		}
		if err := s.Client.DoJSON(s.Ctx, "GET", "/api/rbac/users/"+url.PathEscape(ref), nil, nil, &one); err != nil {
			return "", "", err
		}
		id, _ = one.User["id"].(string)
		name, _ = one.User["username"].(string)
		if id == "" {
			return "", "", usagef("no account has the id %q", ref)
		}
		return id, name, nil
	}
	var got struct {
		Users []map[string]any `json:"users"`
	}
	q := url.Values{"search": {ref}, "limit": {"100"}}
	if err := s.Client.DoJSON(s.Ctx, "GET", "/api/rbac/users", q, nil, &got); err != nil {
		return "", "", err
	}
	var found []map[string]any
	for _, user := range got.Users {
		for _, key := range []string{"id", "username", "email"} {
			if value, _ := user[key].(string); strings.EqualFold(value, ref) {
				found = append(found, user)
				break
			}
		}
	}
	if len(found) != 1 {
		return "", "", usagef("%d accounts match %q exactly by username, email or id", len(found), ref)
	}
	id, _ = found[0]["id"].(string)
	name, _ = found[0]["username"].(string)
	return id, name, nil
}
