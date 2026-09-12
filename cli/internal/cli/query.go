package cli

import (
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/safety"
)

func newQueryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "query [sql]",
		Short: "Run read-only queries safely; writes need --yes",
		Long: `Run SQL against the scoped connection. Plain SELECT/SHOW go
straight through; anything else needs --raw plus --yes, and --dry-run
previews the classified plan without executing. Feed SQL as args, -f file,
or --stdin (pick one). --format picks the server result format while -o
controls how this CLI presents it.`,
		Example: `  chouse query "SELECT number FROM system.numbers LIMIT 5"
  chouse query "SELECT number FROM system.numbers LIMIT 5" --limit 2 -o json
  chouse query --explain plan "SELECT * FROM big WHERE day = today()"
  echo "SELECT 1" | chouse query --stdin -o json
  chouse query --raw --dry-run "ALTER TABLE t UPDATE x = 1 WHERE id = 2"
  chouse query --raw --yes "ALTER TABLE t UPDATE x = 1 WHERE id = 2"`,
	}
	var file, format string
	var limit int
	var stdin bool
	var raw bool
	var explain string

	run := func(_ *cobra.Command, args []string) {
		if file != "" && stdin {
			fail(api.ExitUsage, "use either -f file.sql or --stdin, not both")
		}
		sql := strings.Join(args, " ")
		if file != "" {
			rawBytes, err := os.ReadFile(file)
			if err != nil {
				fail(api.ExitUsage, err.Error())
			}
			sql = string(rawBytes)
		}
		if stdin {
			rawBytes, err := io.ReadAll(os.Stdin)
			if err != nil {
				fail(api.ExitUsage, err.Error())
			}
			sql = string(rawBytes)
		}
		if strings.TrimSpace(sql) == "" {
			fail(api.ExitUsage, "provide SQL as args, -f file.sql, or --stdin")
		}
		if explain != "" {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.QueryExplain(ctx, sql, explain)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
			return
		}
		intent := safety.Classify(sql)
		if intent != safety.IntentRead && !raw {
			fail(api.ExitUsage, "refusing non-SELECT via default path: use --raw with --yes, or run a typed read (table sample, show, system)")
		}
		// Preview first: --dry-run never needs --yes and never executes.
		// Best-effort server simulation when configured, plain plan offline.
		if intent != safety.IntentRead && flagDryRun {
			resolved := mustConfig()
			c := api.New(resolved.Server, resolved.Token, resolved.Connection)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			if sim, err := c.DDLSimulate(ctx, sql); err == nil {
				render(resolved, map[string]any{"dry_run": true, "intent": "write", "simulate": sim})
				return
			}
			render(resolved, map[string]any{"dry_run": true, "intent": "write", "sql": sql})
			return
		}
		if intent != safety.IntentRead {
			confirmDestructive("execute-sql", summarizeSQL(sql))
			auditLine("query.execute", summarizeSQL(sql), "query/table/database per statement")
		}
		c, resolved := mustClient(true)
		ctx, cancel := ctxWithTimeout()
		defer cancel()
		var got map[string]any
		var err error
		if raw {
			got, err = c.QueryExecute(ctx, sql, format, limit)
		} else {
			got, err = c.QueryTableSelect(ctx, sql, limit)
		}
		if err != nil {
			failErr(err)
		}
		render(resolved, got)
	}

	cmd.Run = run
	cmd.Flags().StringVarP(&file, "file", "f", "", "read SQL from file")
	cmd.Flags().StringVar(&format, "format", "JSON", "server result format JSON|JSONEachRow|CSV|TabSeparated (display: -o/--output)")
	cmd.Flags().IntVar(&limit, "limit", 1000, "max result rows (0..100000)")
	cmd.Flags().BoolVar(&stdin, "stdin", false, "read SQL from stdin")
	cmd.Flags().BoolVar(&raw, "raw", false, "allow arbitrary SQL via /execute (writes need --yes)")
	cmd.Flags().StringVar(&explain, "explain", "", "dry-run SELECT via EXPLAIN (plan|ast|syntax|pipeline|estimate)")
	return cmd
}

func summarizeSQL(sql string) string {
	s := strings.Join(strings.Fields(sql), " ")
	if len(s) > 120 {
		return s[:120] + "…"
	}
	return s
}
