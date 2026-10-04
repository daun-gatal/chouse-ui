package cli

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/daun-gatal/chouse-ui/cli/internal/config"
	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// readToken gets the token for auth login without putting it on the
// command line: --token-stdin, else the environment, else a hidden prompt
// on a terminal. --token still works but warns (shell history, ps).
func (a *App) readToken(fromStdin bool) (string, error) {
	if fromStdin {
		line, err := bufio.NewReader(a.In).ReadString('\n')
		if err != nil && strings.TrimSpace(line) == "" {
			return "", usagef("--token-stdin: no token on stdin")
		}
		return strings.TrimSpace(line), nil
	}
	if a.token != "" {
		a.notef("warning: --token puts the token in your shell history and process list; prefer the prompt, --token-stdin or %s", config.EnvToken)
		return a.token, nil
	}
	if env := strings.TrimSpace(os.Getenv(config.EnvToken)); env != "" {
		return env, nil
	}
	if !a.InTTY {
		return "", usagef("no token: pipe it with --token-stdin or set %s (mint one in the UI: Preferences → Personal access tokens)", config.EnvToken)
	}
	fmt.Fprint(a.Err, "Personal access token (input hidden): ")
	if f, ok := a.In.(*os.File); ok {
		raw, err := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(a.Err)
		if err != nil {
			return "", usagef("read token: %v", err)
		}
		return strings.TrimSpace(string(raw)), nil
	}
	line, _ := bufio.NewReader(a.In).ReadString('\n')
	return strings.TrimSpace(line), nil
}

func (a *App) newAuthCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Log in with a personal access token",
		Long: `Manage the personal access token (PAT) this CLI uses. Tokens are
stored 0600 in ~/.config/chouse/credentials.yaml and never printed (only a
masked form). Log in once per profile; every other command then just works.`,
		Example: `  chouse auth login --server https://chouse.corp
  echo "$TOKEN" | chouse auth login --server https://chouse.corp --token-stdin
  chouse auth status
  chouse auth whoami`,
	}

	var tokenStdin bool
	login := &cobra.Command{
		Use:   "login",
		Short: "Validate a token and store it for the profile",
		Long: `Validate a personal access token against the server and store it
(0600) for the profile, remembering --server and --ca-cert so later commands
need no flags. The token is read from a hidden prompt, --token-stdin or
CH_HOUSE_PAT — never pass it as an argument. Mint it once in the UI:
Preferences → Personal access tokens.`,
		Example: `  chouse auth login --server https://chouse.corp
  chouse auth login --server https://chouse.internal --ca-cert corp-ca.pem --profile prod
  echo "$TOKEN" | chouse auth login --server https://chouse.corp --token-stdin`,
		Args: cobra.NoArgs,
		RunE: a.action(needNothing, func(s *Session, _ []string) error {
			if err := s.Cfg.RequireServer(); err != nil {
				return usagef("%v", err)
			}
			token, err := a.readToken(tokenStdin)
			if err != nil {
				return err
			}
			if !strings.HasPrefix(token, "ch_pat_") {
				return usagef("that is not a personal access token (they start with ch_pat_)")
			}
			c, err := a.newClient(s.Cfg, token)
			if err != nil {
				return err
			}
			if _, err := c.Validate(s.Ctx); err != nil {
				return fmt.Errorf("token validation failed: %w", err)
			}
			if err := config.SaveCredentials(s.Cfg.Profile, token); err != nil {
				return err
			}
			// Remember explicitly passed setup only; env stays session-scoped
			// and --insecure-skip-tls-verify is never stored.
			if err := config.SaveProfile(s.Cfg.Profile, config.ProfileUpdate{Server: a.server, CACert: a.caCert}, a.profile != ""); err != nil {
				return err
			}
			s.notef("logged in: profile %q, token %s", s.Cfg.Profile, config.MaskToken(token))
			return s.Print(map[string]any{"profile": s.Cfg.Profile, "server": s.Cfg.Server}, output.View{})
		}),
	}
	login.Flags().BoolVar(&tokenStdin, "token-stdin", false, "read the token from stdin")

	status := &cobra.Command{
		Use:   "status",
		Short: "Show the effective profile without printing secrets",
		Long: `Show the resolved profile, server, connection, CA bundle and masked
token — fully offline, safe to run any time to check what later commands use.`,
		Example: `  chouse auth status
  chouse auth status -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needNothing, func(s *Session, _ []string) error {
			server := s.Cfg.Server
			if server == "" {
				server = "(not configured)"
			}
			return s.Print(map[string]any{
				"profile":    s.Cfg.Profile,
				"server":     server,
				"connection": s.Cfg.Connection,
				"token":      config.MaskToken(s.Cfg.Token),
				"output":     s.Cfg.Output,
				"caCert":     s.Cfg.CACert,
			}, output.View{})
		}),
	}

	whoami := &cobra.Command{
		Use:   "whoami",
		Short: "Show the token's user, roles and permissions",
		Long:  `Ask the server who the token belongs to: user, roles, permissions and data-access rules.`,
		Example: `  chouse auth whoami
  chouse auth whoami -o json | jq .permissions`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			me, err := s.Client.Whoami(s.Ctx)
			if err != nil {
				return err
			}
			// People get a summary; JSON and YAML keep the full profile.
			if s.out.Format == output.Table || s.out.Format == output.CSV {
				user, _ := me["user"].(map[string]any)
				summary := map[string]any{}
				for _, k := range []string{"id", "username", "email", "roles"} {
					summary[k] = user[k]
				}
				summary["permissions"] = countOf(user["permissions"])
				return s.Print(summary, output.View{})
			}
			return s.Print(me, output.View{})
		}),
	}

	logout := &cobra.Command{
		Use:   "logout",
		Short: "Remove the stored token for the profile",
		Long: `Delete the profile's stored token from this machine. The token
stays valid on the server — revoke it in the UI to retire it.`,
		Example: `  chouse auth logout
  chouse auth logout --profile prod`,
		Args: cobra.NoArgs,
		RunE: a.action(needNothing, func(s *Session, _ []string) error {
			if err := config.DeleteCredentials(s.Cfg.Profile); err != nil {
				return err
			}
			s.notef("removed the token for profile %q (revoke it in the UI to retire it)", s.Cfg.Profile)
			return s.Print(map[string]any{"profile": s.Cfg.Profile, "removed": true}, output.View{})
		}),
	}

	cmd.AddCommand(login, status, whoami, logout)
	return cmd
}

func countOf(v any) string {
	if list, ok := v.([]any); ok {
		return fmt.Sprintf("%d (use -o json to list)", len(list))
	}
	return ""
}
