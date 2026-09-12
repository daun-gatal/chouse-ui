package cli

import (
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
)

func newUploadCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "upload",
		Short: "CSV/TSV/JSON import (preview first, into needs --yes)",
		Long: `Import local files into a table. Always preview first: it infers
columns from a small slice and stores nothing. The full streaming import
lands in a follow-up — today into only previews, then points at the UI.`,
		Example: `  chouse upload preview --file rows.csv
  chouse upload preview --file rows.tsv --format TSV --header=false -o json
  chouse upload into --file rows.csv --db analytics --table events --dry-run`,
	}
	var file, format, database, table, columns string
	var hasHeader bool

	preview := &cobra.Command{
		Use:   "preview",
		Short: "Infer columns from a file slice (1 MB, local)",
		Long: `Send a small slice of a local file for column inference (types,
nullability, samples). Stores nothing — the safe first step before any
import. Needs --file; --format picks the file layout.`,
		Example: `  chouse upload preview --file rows.csv
  chouse upload preview --file rows.json --format JSON -o json`,
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
		Long: `Preview how a file would land in database.table: same inference
as preview plus the target. --dry-run needs no confirmation; anything real
currently hands off to Explorer → Upload in the browser.`,
		Example: `  chouse upload into --file rows.csv --db analytics --table events --dry-run
  chouse upload into --file rows.csv --db analytics --table events --dry-run -o json`,
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
	cmd := &cobra.Command{
		Use:   "audit",
		Short: "Audit trail (list/export; prune stays UI-only)",
		Long: `Read the audit trail: who did what, when, from where. Listing
and CSV export are read-only; pruning history stays in the browser. Entries
appear as actions happen — run a command, then check here.`,
		Example: `  chouse audit list --limit 5
  chouse audit list --action clickhouse.query_execute -o json
  chouse audit export --limit 100 > audit.csv`,
	}
	var limit int
	var action, status, user string

	list := &cobra.Command{
		Use:   "list",
		Short: "List audit entries (own scope unless audit:view)",
		Long: `List audit entries, newest first. You see your own actions
unless you hold audit:view. Filter by action, status, or user id; cap with
--limit.`,
		Example: `  chouse audit list --limit 5
  chouse audit list --action clickhouse.query_execute --status success -o json`,
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
		Long: `Export audit entries as raw CSV bytes to stdout — redirect to a
file. Same filters as list; bypasses -o (bytes, not a document). Pruning
stays in the browser.`,
		Example: `  chouse audit export --limit 100 > audit.csv
  chouse audit export --action clickhouse.query_execute --limit 1000 > queries.csv`,
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
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Profiles and local settings",
		Long: `Inspect and switch local profiles (~/.config/chouse/config.yaml).
Profiles hold non-secret defaults (server, connection); tokens live
separately in credentials.yaml. Most users set everything via auth login.`,
		Example: `  chouse auth status
  chouse config use-profile prod`,
	}
	use := &cobra.Command{
		Use:   "use-profile <name>",
		Short: "Switch profile (writes config.yaml, no secrets)",
		Long: `Switch the current profile. Currently a guided stub: edit
~/.config/chouse/config.yaml and set current_profile, keeping secrets out
of the file (tokens stay in credentials.yaml).`,
		Example: `  # in ~/.config/chouse/config.yaml, set:
  # current_profile: prod
  chouse auth status --profile prod`,
		Args: cobra.ExactArgs(1),
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
