package cli

import (
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

func (a *App) newUploadCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "upload",
		Short: "Check how a CSV/TSV/JSON file would import",
		Long: `Send the first megabyte of a file for column inference — names,
types, nullability and sample values. Nothing is stored. Importing the file
stays in the UI (Explorer › Upload), or use chouse query --raw with INSERT.`,
		Example: `  chouse upload preview rows.csv
  chouse upload preview rows.tsv --format TSV --header=false -o json`,
	}
	var format string
	var header bool
	preview := &cobra.Command{
		Use:     "preview <file>",
		Short:   "Infer columns from a file",
		Example: `  chouse upload preview rows.csv`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.UploadPreview(s.Ctx, args[0], strings.ToUpper(format), header)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{List: "columns"})
		}),
	}
	preview.Flags().StringVar(&format, "format", "CSV", "file format: CSV, TSV or JSON")
	preview.Flags().BoolVar(&header, "header", true, "the first row is a header")
	cmd.AddCommand(preview)
	return cmd
}

func (a *App) newAuditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "audit",
		Short: "Audit log: list and export",
		Long: `Who did what, when and from where. You see your own entries
unless you hold audit:view. export writes CSV (audit:export). Pruning stays
in the UI.`,
		Example: `  chouse audit list --limit 20
  chouse audit list --action mcp.tool_call --status failed
  chouse audit export --limit 5000 > audit.csv`,
	}
	var limit int
	var action, status, user string
	query := func() url.Values {
		q := url.Values{}
		if limit > 0 {
			q.Set("limit", itoa(limit))
		}
		for k, v := range map[string]string{"action": action, "status": status, "userId": user} {
			if v != "" {
				q.Set(k, v)
			}
		}
		return q
	}
	filters := func(c *cobra.Command, defaultLimit int) {
		c.Flags().IntVar(&limit, "limit", defaultLimit, "max rows")
		c.Flags().StringVar(&action, "action", "", "only this action, e.g. mcp.tool_call")
		c.Flags().StringVar(&status, "status", "", "success or failed")
		c.Flags().StringVar(&user, "user", "", "only this user id")
	}
	list := &cobra.Command{
		Use:     "list",
		Short:   "List entries, newest first",
		Example: `  chouse audit list --limit 20`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/rbac/audit", query())
			if err != nil {
				return err
			}
			return s.Print(got, view("", "TIME=createdAt", "USER=usernameSnapshot", "ACTION", "STATUS", "RESOURCE=resourceType", "ID=resourceId", "IP=ipAddress"))
		}),
	}
	filters(list, 50)
	export := &cobra.Command{
		Use:     "export",
		Short:   "Export entries as CSV (up to 10000)",
		Long:    `Write audit entries as CSV to stdout (always CSV; -o does not apply). Same filters as list.`,
		Example: `  chouse audit export --limit 1000 > audit.csv`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			raw, _, err := s.Client.GetRaw(s.Ctx, "/api/rbac/audit/export", query())
			if err != nil {
				return err
			}
			_, err = s.Out.Write(raw)
			return err
		}),
	}
	filters(export, 1000)
	cmd.AddCommand(list, export)
	return cmd
}
