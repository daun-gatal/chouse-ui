// Package output renders machine-stable results for humans and agents.
package output

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Format names accepted by --output.
const (
	Table = "table"
	JSON  = "json"
	YAML  = "yaml"
	CSV   = "csv"
)

// Print renders value in the requested format to w.
func Print(w io.Writer, format string, value any) error {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", Table:
		return printTable(w, value)
	case JSON:
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(value)
	case YAML:
		raw, err := yaml.Marshal(value)
		if err != nil {
			return err
		}
		_, err = w.Write(raw)
		return err
	case CSV:
		return printCSV(w, value)
	default:
		return fmt.Errorf("unknown --output %q (want table|json|yaml|csv)", format)
	}
}

func printTable(w io.Writer, value any) error {
	rows := toRows(value)
	if len(rows) == 0 {
		_, err := fmt.Fprintln(w, "(no rows)")
		return err
	}
	cols := columns(rows)
	widths := make([]int, len(cols))
	for i, c := range cols {
		widths[i] = len(c)
	}
	for _, r := range rows {
		for i, c := range cols {
			if len(r[c]) > widths[i] {
				widths[i] = len(r[c])
			}
		}
	}
	var b strings.Builder
	for i, c := range cols {
		b.WriteString(pad(c, widths[i]))
		if i < len(cols)-1 {
			b.WriteString("  ")
		}
	}
	b.WriteString("\n")
	for i := range cols {
		b.WriteString(strings.Repeat("-", widths[i]))
		if i < len(cols)-1 {
			b.WriteString("  ")
		}
	}
	b.WriteString("\n")
	for _, r := range rows {
		for i, c := range cols {
			b.WriteString(pad(r[c], widths[i]))
			if i < len(cols)-1 {
				b.WriteString("  ")
			}
		}
		b.WriteString("\n")
	}
	_, err := io.WriteString(w, b.String())
	return err
}

func printCSV(w io.Writer, value any) error {
	rows := toRows(value)
	cw := csv.NewWriter(w)
	if len(rows) == 0 {
		cw.Flush()
		return cw.Error()
	}
	cols := columns(rows)
	if err := cw.Write(cols); err != nil {
		return err
	}
	for _, r := range rows {
		rec := make([]string, len(cols))
		for i, c := range cols {
			rec[i] = r[c]
		}
		if err := cw.Write(rec); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// toRows normalizes maps, slices, and QueryResult-shaped payloads.
func toRows(value any) []map[string]string {
	if value == nil {
		return nil
	}
	// Unwrap {data: …} and QueryResult {meta,data}.
	if m, ok := value.(map[string]any); ok {
		if d, ok := m["data"]; ok {
			if dm, ok := d.(map[string]any); ok {
				if rows, ok := dm["data"]; ok {
					return toRows(map[string]any{"rows": rows, "meta": dm["meta"]})
				}
			}
			return toRows(d)
		}
		if rows, ok := m["rows"]; ok {
			_ = rows
		}
		if data, ok := m["data"]; ok {
			_ = data
		}
		// QueryResult: data=[{…}] with meta=[{name}].
		if data, ok := m["data"]; ok {
			return rowsFrom(data, m["meta"])
		}
		return []map[string]string{stringifyMap(m)}
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		var out []map[string]string
		for i := 0; i < rv.Len(); i++ {
			item := rv.Index(i).Interface()
			if m, ok := item.(map[string]any); ok {
				out = append(out, stringifyMap(m))
			} else {
				out = append(out, map[string]string{"value": fmt.Sprint(item)})
			}
		}
		return out
	}
	return []map[string]string{{"value": fmt.Sprint(value)}}
}

func rowsFrom(data, meta any) []map[string]string {
	rv := reflect.ValueOf(data)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return nil
	}
	names := columnNames(meta)
	var out []map[string]string
	for i := 0; i < rv.Len(); i++ {
		row := rv.Index(i).Interface()
		if m, ok := row.(map[string]any); ok {
			out = append(out, stringifyMap(m))
			continue
		}
		// Array row with meta names: [v0, v1, …].
		rr := reflect.ValueOf(row)
		if (rr.Kind() == reflect.Slice || rr.Kind() == reflect.Array) && len(names) > 0 {
			m := map[string]string{}
			for j := 0; j < rr.Len() && j < len(names); j++ {
				m[names[j]] = fmt.Sprint(rr.Index(j).Interface())
			}
			out = append(out, m)
			continue
		}
		out = append(out, map[string]string{"value": fmt.Sprint(row)})
	}
	return out
}

func columnNames(meta any) []string {
	var out []string
	rv := reflect.ValueOf(meta)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return out
	}
	for i := 0; i < rv.Len(); i++ {
		if m, ok := rv.Index(i).Interface().(map[string]any); ok {
			if n, ok := m["name"].(string); ok {
				out = append(out, n)
			}
		}
	}
	return out
}

func stringifyMap(m map[string]any) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		switch t := v.(type) {
		case string:
			out[k] = t
		case nil:
			out[k] = ""
		default:
			raw, err := json.Marshal(v)
			if err != nil {
				out[k] = fmt.Sprint(v)
			} else {
				out[k] = string(raw)
			}
		}
	}
	return out
}

func columns(rows []map[string]string) []string {
	set := map[string]struct{}{}
	for _, r := range rows {
		for k := range r {
			set[k] = struct{}{}
		}
	}
	cols := make([]string, 0, len(set))
	for k := range set {
		cols = append(cols, k)
	}
	sort.Strings(cols)
	return cols
}

func pad(s string, w int) string {
	if len(s) >= w {
		return s
	}
	return s + strings.Repeat(" ", w-len(s))
}
