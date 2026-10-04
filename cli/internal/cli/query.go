package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
	"github.com/daun-gatal/chouse-ui/cli/internal/safety"
)

// resultView shows a ClickHouse JSON result ({meta, data, statistics}) as
// rows, with columns in the result's own order.
func resultView(result map[string]any) output.View {
	meta, _ := result["meta"].([]any)
	columns := make([]output.Column, 0, len(meta))
	for _, m := range meta {
		col, _ := m.(map[string]any)
		name, _ := col["name"].(string)
		if name != "" {
			columns = append(columns, output.Column{Header: name, Path: name})
		}
	}
	return output.View{List: "data", Columns: columns}
}

// printResult writes a query result to stdout or --out, and a row/time
// summary to stderr for people.
func (s *Session) printResult(result map[string]any, outFile string) error {
	v := resultView(result)
	if _, ok := result["data"].([]any); !ok {
		v = output.View{}
	}
	if outFile != "" {
		opts := s.out
		// The extension decides the format unless -o was given explicitly.
		if s.Cfg.Output == "" || s.Cfg.Output == output.Auto {
			switch strings.ToLower(filepath.Ext(outFile)) {
			case ".csv":
				opts.Format = output.CSV
			case ".yaml", ".yml":
				opts.Format = output.YAML
			default:
				opts.Format = output.JSON
			}
		}
		f, err := os.Create(outFile)
		if err != nil {
			return usagef("%v", err)
		}
		if err := output.Print(f, result, v, opts); err != nil {
			f.Close()
			return err
		}
		if err := f.Close(); err != nil {
			return err
		}
		s.notef("wrote %s (%s)", outFile, opts.Format)
	} else if err := s.Print(result, v); err != nil {
		return err
	}
	if s.out.Format == output.Table || outFile != "" {
		s.notef("%s", resultSummary(result))
	}
	return nil
}

func resultSummary(result map[string]any) string {
	rows := 0
	if data, ok := result["data"].([]any); ok {
		rows = len(data)
	}
	summary := fmt.Sprintf("%d row(s)", rows)
	if stats, ok := result["statistics"].(map[string]any); ok {
		if elapsed, ok := stats["elapsed"].(float64); ok {
			summary += fmt.Sprintf(" in %.3fs", elapsed)
		}
		if read, ok := stats["rows_read"].(float64); ok {
			summary += fmt.Sprintf(", %.0f rows read", read)
		}
	}
	if truncated, _ := result["truncated"].(bool); truncated {
		summary += " (truncated: raise --limit)"
	}
	return summary
}

func (a *App) newQueryCmd() *cobra.Command {
	var file, format, explain, outFile string
	var limit int
	var stdin, raw bool
	cmd := &cobra.Command{
		Use:   "query [sql]",
		Short: "Run SQL: read-only by default, writes with --raw",
		Long: `Run SQL on the -c connection. SELECT, WITH, SHOW, DESCRIBE and
EXPLAIN run directly and print as a table (or -o csv/json/yaml). Anything
else needs --raw, and then a confirmation or --yes; --dry-run estimates it
without running it. Give SQL as arguments, -f FILE (- for stdin) or --stdin.
--out FILE writes the result to a file (format from the extension).`,
		Example: `  chouse query "SELECT name, engine FROM system.tables LIMIT 5"
  chouse query -f report.sql --out report.csv
  chouse query "SELECT * FROM events LIMIT 1000" -o csv > events.csv
  chouse query --explain plan "SELECT * FROM big WHERE day = today()"
  chouse query --raw --dry-run "ALTER TABLE t DELETE WHERE id = 2"
  chouse query --raw --yes "ALTER TABLE t DELETE WHERE id = 2"`,
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			sql, err := a.readSQL(file, stdin, args)
			if err != nil {
				return err
			}
			if explain != "" {
				got, err := s.Client.QueryExplain(s.Ctx, sql, explain)
				if err != nil {
					return err
				}
				return s.Print(got, output.View{})
			}
			read := safety.Classify(sql) == safety.IntentRead
			if !read && !raw {
				return usagef("only read-only SQL runs by default: add --raw (and confirm or --yes) to run %q", summarizeSQL(sql))
			}
			if !read && a.dryRun {
				// Preview: the server estimates affected rows and never executes.
				if sim, err := s.Client.DDLSimulate(s.Ctx, sql); err == nil {
					return s.Print(map[string]any{"dryRun": true, "sql": summarizeSQL(sql), "estimate": sim}, output.View{})
				}
				return s.Print(map[string]any{"dryRun": true, "sql": summarizeSQL(sql), "estimate": "not available for this statement"}, output.View{})
			}
			if !read {
				if err := s.confirm("run SQL", summarizeSQL(sql)); err != nil {
					return err
				}
				s.audit("query.execute", summarizeSQL(sql), "query:execute:ddl|dml")
			}
			var result map[string]any
			if raw {
				result, err = s.Client.QueryExecute(s.Ctx, sql, format, limit)
			} else {
				result, err = s.Client.QueryTableSelect(s.Ctx, sql, limit)
			}
			if err != nil {
				return err
			}
			return s.printResult(result, outFile)
		}),
	}
	cmd.Flags().StringVarP(&file, "file", "f", "", "read SQL from a file (- for stdin)")
	cmd.Flags().BoolVar(&stdin, "stdin", false, "read SQL from stdin")
	cmd.Flags().IntVar(&limit, "limit", 1000, "max result rows (1-100000)")
	cmd.Flags().BoolVar(&raw, "raw", false, "allow any SQL (writes need confirmation or --yes)")
	cmd.Flags().StringVar(&format, "format", "JSON", "with --raw: the server result format (JSON, JSONEachRow, CSV, TabSeparated)")
	cmd.Flags().StringVar(&explain, "explain", "", "show the plan instead of running: plan|ast|syntax|pipeline|estimate")
	cmd.Flags().StringVar(&outFile, "out", "", "write the result to a file (.csv, .json, .yaml)")
	return cmd
}
