package cli

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// readSQL takes SQL from -f FILE (or -f - for stdin), --stdin, or the
// arguments — exactly one source.
func (a *App) readSQL(file string, stdin bool, args []string) (string, error) {
	sources := 0
	if file != "" {
		sources++
	}
	if stdin {
		sources++
	}
	if len(args) > 0 {
		sources++
	}
	if sources > 1 {
		return "", usagef("give SQL one way: arguments, -f FILE or --stdin")
	}
	var sql string
	switch {
	case file == "-" || stdin:
		raw, err := io.ReadAll(a.In)
		if err != nil {
			return "", usagef("read stdin: %v", err)
		}
		sql = string(raw)
	case file != "":
		raw, err := os.ReadFile(file)
		if err != nil {
			return "", usagef("%v", err)
		}
		sql = string(raw)
	default:
		sql = strings.Join(args, " ")
	}
	if strings.TrimSpace(sql) == "" {
		return "", usagef("provide SQL as arguments, -f FILE or --stdin")
	}
	return sql, nil
}

// splitTable parses "db.table".
func splitTable(fq string) (string, string, error) {
	dot := strings.Index(fq, ".")
	if dot <= 0 || dot == len(fq)-1 {
		return "", "", usagef("expected <database>.<table>, got %q", fq)
	}
	return fq[:dot], fq[dot+1:], nil
}

// requireConnection fails fast when a command needs a connection.
func (s *Session) requireConnection(what string) error {
	if s.Cfg.Connection == "" {
		return usagef("%s needs a connection: pass -c <name|id>, set CHOUSE_CONNECTION, or chouse config set connection <name>", what)
	}
	return nil
}

// connectionQuery scopes a list to the -c connection when one is set.
func (s *Session) connectionQuery() url.Values {
	q := url.Values{}
	if s.Cfg.Connection != "" {
		q.Set("connectionId", s.Cfg.Connection)
	}
	return q
}

// limitList caps the rows at path client-side so --limit is honest on
// endpoints without server paging. path "" means the value is the list.
func limitList(value any, path string, limit int) any {
	if limit <= 0 {
		return value
	}
	if path == "" {
		if list, ok := value.([]any); ok && len(list) > limit {
			return list[:limit]
		}
		return value
	}
	if obj, ok := value.(map[string]any); ok {
		if list, ok := obj[path].([]any); ok && len(list) > limit {
			obj[path] = list[:limit]
		}
	}
	return value
}

func itoa(v int) string {
	return strconv.Itoa(v)
}

func summarizeSQL(sql string) string {
	s := strings.Join(strings.Fields(sql), " ")
	if len([]rune(s)) > 120 {
		return string([]rune(s)[:120]) + "…"
	}
	return s
}

// cols builds table columns from "HEADER=path" pairs ("HEADER" alone uses
// the lowercased header as the path).
func cols(specs ...string) []output.Column {
	out := make([]output.Column, 0, len(specs))
	for _, spec := range specs {
		header, path, found := strings.Cut(spec, "=")
		if !found {
			path = strings.ToLower(header)
		}
		out = append(out, output.Column{Header: header, Path: path})
	}
	return out
}

// view is a table view of the list at path with the given columns.
func view(path string, specs ...string) output.View {
	return output.View{List: path, Columns: cols(specs...)}
}

// bytesCol formats a byte count for people.
func bytesCol(header, path string) output.Column {
	return output.Column{Header: header, Path: path, Format: func(v any) string {
		n, ok := v.(float64)
		if !ok {
			return fmt.Sprint(v)
		}
		units := []string{"B", "KiB", "MiB", "GiB", "TiB", "PiB"}
		i := 0
		for n >= 1024 && i < len(units)-1 {
			n /= 1024
			i++
		}
		if i == 0 {
			return fmt.Sprintf("%.0f %s", n, units[i])
		}
		return fmt.Sprintf("%.1f %s", n, units[i])
	}}
}
