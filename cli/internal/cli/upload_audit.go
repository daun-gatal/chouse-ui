package cli

import (
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
)

func newUploadCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "upload", Short: "CSV/TSV/JSON import (preview first, into needs --yes)"}
	var file, format, database, table, columns string
	var hasHeader bool

	preview := &cobra.Command{
		Use:   "preview",
		Short: "Infer columns from a file slice (1 MB, local)",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.UploadPreview(ctx, file, format, hasHeader)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	preview.Flags().StringVar(&file, "file", "", "path (required)")
	preview.Flags().StringVar(&format, "format", "CSV", "upload file format CSV|TSV|JSON")
	preview.Flags().BoolVar(&hasHeader, "header", true, "first row is header")
	_ = preview.MarkFlagRequired("file")

	into := &cobra.Command{
		Use:   "into",
		Short: "Stream a file into database.table (destructive INSERT)",
		Run: func(_ *cobra.Command, _ []string) {
			target := database + "." + table
			// Preview first: --dry-run never needs --yes (file parsing is
			// server-side but never stores anything).
			if flagDryRun {
				c, resolved := mustClient(true)
				ctx, cancel := ctxWithTimeout()
				defer cancel()
				got, err := c.UploadPreview(ctx, file, format, hasHeader)
				if err != nil {
					failErr(err)
				}
				render(resolved, map[string]any{"dry_run": true, "target": target, "preview": got})
				return
			}
			confirmDestructive("upload.into", target)
			uiOnly("upload into "+target, "Explorer → Upload (CLI streaming lands in a follow-up; preview above is the safe plan)")
		},
	}
	into.Flags().StringVar(&file, "file", "", "path (required)")
	into.Flags().StringVar(&format, "format", "CSV", "upload file format CSV|TSV|JSON")
	into.Flags().StringVar(&database, "db", "", "database (required)")
	into.Flags().StringVar(&table, "table", "", "table (required)")
	into.Flags().StringVar(&columns, "columns", "", "optional column list")
	into.Flags().BoolVar(&hasHeader, "header", true, "first row is header")
	_ = into.MarkFlagRequired("file")
	_ = into.MarkFlagRequired("db")
	_ = into.MarkFlagRequired("table")

	cmd.AddCommand(preview, into)
	return cmd
}

func newAuditCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "audit", Short: "Audit trail (list/export; prune stays UI-only)"}
	var limit int
	var action, status, user string

	list := &cobra.Command{
		Use:   "list",
		Short: "List audit entries (own scope unless audit:view)",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/rbac/audit", auditQuery(limit, action, status, user))
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	list.Flags().IntVar(&limit, "limit", 50, "max rows")
	list.Flags().StringVar(&action, "action", "", "filter by action")
	list.Flags().StringVar(&status, "status", "", "filter by status")
	list.Flags().StringVar(&user, "user", "", "filter by user ID")

	export := &cobra.Command{
		Use:   "export",
		Short: "Export audit CSV (up to 10000 rows)",
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			raw, ctype, err := c.GetRaw(ctx, "/api/rbac/audit/export", auditQuery(limit, action, status, user))
			if err != nil {
				failErr(err)
			}
			if strings.Contains(ctype, "json") {
				var decoded any
				if jerr := jsonUnmarshal(raw, &decoded); jerr == nil {
					render(resolved, decoded)
					return
				}
			}
			_, _ = os.Stdout.Write(raw)
		},
	}
	export.Flags().IntVar(&limit, "limit", 1000, "max rows")
	export.Flags().StringVar(&action, "action", "", "filter by action")
	export.Flags().StringVar(&status, "status", "", "filter by status")
	export.Flags().StringVar(&user, "user", "", "filter by user ID")

	cmd.AddCommand(list, export)
	return cmd
}

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "config", Short: "Profiles and local settings"}
	use := &cobra.Command{
		Use:   "use-profile <name>",
		Short: "Switch profile (writes config.yaml, no secrets)",
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			uiOnly("profile switch helper", "edit ~/.config/chouse/config.yaml (profile "+args[0]+")")
		},
	}
	cmd.AddCommand(use)
	return cmd
}

func readSQLInput(file string, stdin bool, args []string) string {
	if file != "" {
		raw, err := os.ReadFile(file)
		if err != nil {
			fail(api.ExitUsage, err.Error())
		}
		return string(raw)
	}
	if stdin {
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			fail(api.ExitUsage, err.Error())
		}
		return string(raw)
	}
	return strings.Join(args, " ")
}
