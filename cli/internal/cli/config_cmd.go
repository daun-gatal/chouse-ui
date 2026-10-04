package cli

import (
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/config"
	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

func (a *App) newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Profiles and their settings",
		Long: `Profiles hold non-secret defaults — server, connection, output and
CA bundle — in ~/.config/chouse/config.yaml. Tokens live separately in
credentials.yaml and are set with chouse auth login. --profile (or
CHOUSE_PROFILE) picks a profile for one command; use-profile switches the
default.`,
		Example: `  chouse config view
  chouse config set connection prod
  chouse config use-profile staging
  chouse config profiles`,
	}

	viewCmd := &cobra.Command{
		Use:   "view",
		Short: "Show the effective settings and where each comes from",
		Long:  `Show the settings this invocation resolves to (flags > environment > profile), with the token masked.`,
		Example: `  chouse config view
  chouse config view --profile prod -o yaml`,
		Args: cobra.NoArgs,
		RunE: a.action(needNothing, func(s *Session, _ []string) error {
			return s.Print(map[string]any{
				"profile":    s.Cfg.Profile,
				"server":     s.Cfg.Server,
				"connection": s.Cfg.Connection,
				"output":     s.Cfg.Output,
				"caCert":     s.Cfg.CACert,
				"token":      config.MaskToken(s.Cfg.Token),
			}, output.View{})
		}),
	}

	get := &cobra.Command{
		Use:       "get <key>",
		Short:     "Print one profile setting (" + strings.Join(config.ProfileKeys, ", ") + ")",
		Long:      `Print one setting stored in the profile (not the flag or environment override).`,
		Example:   `  chouse config get server`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: config.ProfileKeys,
		RunE: a.action(needNothing, func(s *Session, args []string) error {
			cfg, err := config.LoadFile()
			if err != nil {
				return err
			}
			value, err := config.ProfileValue(cfg.Profiles[s.Cfg.Profile], args[0])
			if err != nil {
				return usagef("%v", err)
			}
			_, err = s.Out.Write([]byte(value + "\n"))
			return err
		}),
	}

	set := &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a profile setting (" + strings.Join(config.ProfileKeys, ", ") + ")",
		Long: `Store a non-secret setting in the profile (current, or --profile).
connection takes a name or an id; output takes auto, table, csv, json or
yaml; ca_cert is stored as an absolute path. Tokens are not settable here —
use chouse auth login.`,
		Example: `  chouse config set server https://chouse.corp
  chouse config set connection prod
  chouse config set output json --profile ci`,
		Args:      cobra.ExactArgs(2),
		ValidArgs: config.ProfileKeys,
		RunE: a.action(needNothing, func(s *Session, args []string) error {
			if args[0] == "output" {
				if _, err := output.Resolve(args[1], true); err != nil {
					return usagef("%v", err)
				}
			}
			if err := config.SetProfileValue(s.Cfg.Profile, args[0], args[1]); err != nil {
				return usagef("%v", err)
			}
			s.notef("set %s for profile %q", args[0], s.Cfg.Profile)
			return nil
		}),
	}

	unset := &cobra.Command{
		Use:       "unset <key>",
		Short:     "Clear a profile setting",
		Example:   `  chouse config unset connection`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: config.ProfileKeys,
		RunE: a.action(needNothing, func(s *Session, args []string) error {
			if err := config.SetProfileValue(s.Cfg.Profile, args[0], ""); err != nil {
				return usagef("%v", err)
			}
			s.notef("cleared %s for profile %q", args[0], s.Cfg.Profile)
			return nil
		}),
	}

	use := &cobra.Command{
		Use:     "use-profile <name>",
		Short:   "Make a profile the default",
		Long:    `Switch the default profile. It must already exist (create one with chouse auth login --profile NAME).`,
		Example: `  chouse config use-profile prod`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needNothing, func(s *Session, args []string) error {
			if err := config.UseProfile(args[0]); err != nil {
				return usagef("%v", err)
			}
			s.notef("now using profile %q", args[0])
			return nil
		}),
	}

	profiles := &cobra.Command{
		Use:     "profiles",
		Short:   "List profiles",
		Example: `  chouse config profiles`,
		Args:    cobra.NoArgs,
		RunE: a.action(needNothing, func(s *Session, _ []string) error {
			list, err := config.ListProfiles()
			if err != nil {
				return err
			}
			return s.Print(list, output.View{Columns: []output.Column{
				{Header: "current", Path: "current", Format: func(v any) string {
					if b, _ := v.(bool); b {
						return "*"
					}
					return ""
				}},
				{Header: "name"}, {Header: "server"}, {Header: "token", Path: "hasToken", Format: func(v any) string {
					if b, _ := v.(bool); b {
						return "stored"
					}
					return "none"
				}},
			}})
		}),
	}

	remove := &cobra.Command{
		Use:     "delete-profile <name>",
		Short:   "Delete a profile and its stored token",
		Example: `  chouse config delete-profile old --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needNothing, func(s *Session, args []string) error {
			if err := s.confirm("delete profile", args[0]); err != nil {
				return err
			}
			if err := config.DeleteProfile(args[0]); err != nil {
				return err
			}
			s.notef("deleted profile %q (its token stays valid on the server until revoked)", args[0])
			return nil
		}),
	}

	cmd.AddCommand(viewCmd, get, set, unset, use, profiles, remove)
	return cmd
}
