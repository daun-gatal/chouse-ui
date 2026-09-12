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
	cmd := &cobra.Command{Use: "query", Short: "Run read-only queries safely; writes need --yes"}
	var file, format string
	var limit int
	var stdin bool
	var raw bool
	var explain string

	run := func(_ *cobra.Command, args []string) {
		c, resolved := mustClient(true)
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
		if intent != safety.IntentRead {
			confirmDestructive("execute-sql", summarizeSQL(sql))
			if flagDryRun {
				ctx, cancel := ctxWithTimeout()
				defer cancel()
				// Best-effort dry-run: DDL simulate for ALTER UPDATE/DELETE,
				// otherwise echo the classified plan without executing.
				if sim, err := c.DDLSimulate(ctx, sql); err == nil {
					render(resolved, map[string]any{"dry_run": true, "intent": "write", "simulate": sim})
					return
				}
				render(resolved, map[string]any{"dry_run": true, "intent": "write", "sql": sql})
				return
			}
			auditLine("query.execute", summarizeSQL(sql), "query/table/database per statement")
		}
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
	cmd.Flags().StringVar(&format, "format", "JSON", "result format JSON|JSONEachRow|CSV|TabSeparated")
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
