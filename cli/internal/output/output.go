// Package output renders command results for people and for programs.
//
// One result value, four presentations: `table` (aligned columns for a
// terminal), `csv`, and `json`/`yaml` (the full value, unchanged). The
// default `auto` picks `table` when stdout is a terminal and `json` when it
// is piped, so scripts keep a machine format without asking for one.
package output

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"

	"gopkg.in/yaml.v3"
)

// Format names accepted by --output.
const (
	Auto  = "auto"
	Table = "table"
	CSV   = "csv"
	JSON  = "json"
	YAML  = "yaml"
)

// Formats lists every accepted --output value.
var Formats = []string{Auto, Table, CSV, JSON, YAML}

// Resolve turns a requested format into a concrete one. `auto` (or empty)
// is `table` on a terminal and `json` otherwise.
func Resolve(requested string, terminal bool) (string, error) {
	switch f := strings.ToLower(strings.TrimSpace(requested)); f {
	case "", Auto:
		if terminal {
			return Table, nil
		}
		return JSON, nil
	case Table, CSV, JSON, YAML:
		return f, nil
	default:
		return "", fmt.Errorf("unknown --output %q (want %s)", requested, strings.Join(Formats, "|"))
	}
}

// Column picks one field of a record for table and CSV output.
type Column struct {
	Header string
	// Path is a dot path into the record ("user.email"). Empty uses Header
	// lowercased.
	Path string
	// Format overrides how the value is shown.
	Format func(any) string
}

// View tells table/CSV output where the rows are and which columns to show.
// JSON and YAML ignore it and print the whole value.
type View struct {
	// List is a dot path to the rows ("sessions", "data.items"). Empty finds
	// them: the value itself when it is a list, or its only list field.
	List string
	// Columns to show. Empty derives them from the rows' scalar fields.
	Columns []Column
}

// Options controls rendering.
type Options struct {
	Format    string
	NoHeaders bool
	// Wide disables cell truncation in tables.
	Wide bool
}

const (
	maxAutoColumns   = 8
	maxCellWidth     = 60
	maxWrapperFields = 4
)

// Print renders value to w.
func Print(w io.Writer, value any, view View, opts Options) error {
	switch opts.Format {
	case JSON, "":
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		return enc.Encode(value)
	case YAML:
		raw, err := yaml.Marshal(normalize(value))
		if err != nil {
			return err
		}
		_, err = w.Write(raw)
		return err
	case Table, CSV:
		headers, rows := Tabulate(value, view)
		if opts.Format == CSV {
			return writeCSV(w, headers, rows, opts.NoHeaders)
		}
		return writeTable(w, headers, rows, opts)
	default:
		return fmt.Errorf("unknown output format %q", opts.Format)
	}
}

// Tabulate turns a value into headers and string cells.
func Tabulate(value any, view View) ([]string, [][]string) {
	value = normalize(value)
	records, isList := findRows(value, view.List)
	if !isList {
		// A single object: one row per field.
		obj, ok := value.(map[string]any)
		if !ok {
			return []string{"VALUE"}, [][]string{{cell(value)}}
		}
		keys := sortedKeys(obj)
		rows := make([][]string, 0, len(keys))
		for _, k := range keys {
			rows = append(rows, []string{k, cell(obj[k])})
		}
		return []string{"FIELD", "VALUE"}, rows
	}
	columns := view.Columns
	if len(columns) == 0 {
		columns = autoColumns(records)
	}
	headers := make([]string, len(columns))
	for i, c := range columns {
		headers[i] = strings.ToUpper(c.Header)
	}
	rows := make([][]string, 0, len(records))
	for _, r := range records {
		row := make([]string, len(columns))
		for i, c := range columns {
			path := c.Path
			if path == "" {
				path = strings.ToLower(c.Header)
			}
			v := lookup(r, path)
			if c.Format != nil {
				row[i] = c.Format(v)
			} else {
				row[i] = cell(v)
			}
		}
		rows = append(rows, row)
	}
	return headers, rows
}

func findRows(value any, path string) ([]any, bool) {
	if path != "" {
		if list, ok := lookup(value, path).([]any); ok {
			return list, true
		}
		return nil, false
	}
	if list, ok := value.([]any); ok {
		return list, true
	}
	// A small wrapper such as {queries: [...], total: 3} holds one list and
	// a few scalars of metadata. A record that happens to contain a list
	// (a job's channelIds) is shown as its fields instead.
	if obj, ok := value.(map[string]any); ok && len(obj) <= maxWrapperFields {
		var only []any
		count := 0
		for _, v := range obj {
			if list, ok := v.([]any); ok {
				only = list
				count++
			} else if !isScalar(v) {
				return nil, false
			}
		}
		if count == 1 {
			return only, true
		}
	}
	return nil, false
}

// Rows reports how many rows a table or CSV view of value has.
func Rows(value any, view View) int {
	_, rows := Tabulate(value, view)
	return len(rows)
}

// autoColumns takes the scalar fields of the rows, in first-seen order.
func autoColumns(records []any) []Column {
	var cols []Column
	seen := map[string]bool{}
	for _, r := range records {
		obj, ok := r.(map[string]any)
		if !ok {
			if !seen[""] {
				seen[""] = true
				cols = append(cols, Column{Header: "value", Path: "."})
			}
			continue
		}
		for _, k := range sortedKeys(obj) {
			if seen[k] || !isScalar(obj[k]) {
				continue
			}
			seen[k] = true
			cols = append(cols, Column{Header: k, Path: k})
		}
		if len(cols) >= maxAutoColumns {
			break
		}
	}
	if len(cols) > maxAutoColumns {
		cols = cols[:maxAutoColumns]
	}
	return cols
}

// preferredFirst puts identifying fields before the rest of a record.
var preferredFirst = map[string]int{"id": 0, "name": 1, "title": 2, "status": 3, "state": 4}

func sortedKeys(obj map[string]any) []string {
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.SliceStable(keys, func(i, j int) bool {
		pi, iok := preferredFirst[keys[i]]
		pj, jok := preferredFirst[keys[j]]
		switch {
		case iok && jok:
			return pi < pj
		case iok:
			return true
		case jok:
			return false
		}
		return keys[i] < keys[j]
	})
	return keys
}

func isScalar(v any) bool {
	switch v.(type) {
	case nil, string, bool, float64, int, int64, json.Number:
		return true
	}
	return false
}

// lookup follows a dot path through maps; "." is the value itself.
func lookup(value any, path string) any {
	if path == "." {
		return value
	}
	cur := value
	for _, part := range strings.Split(path, ".") {
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = obj[part]
	}
	return cur
}

// cell renders one value for a table or CSV cell.
func cell(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		if t == math.Trunc(t) && math.Abs(t) < 1e15 {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case json.Number:
		return t.String()
	default:
		raw, err := json.Marshal(t)
		if err != nil {
			return fmt.Sprint(t)
		}
		return string(raw)
	}
}

// normalize round-trips Go values through JSON so typed structs, maps and
// numbers all reach the renderers as map[string]any / []any / float64.
func normalize(value any) any {
	switch value.(type) {
	case map[string]any, []any, string, float64, bool, nil:
		return value
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return value
	}
	return out
}

func writeTable(w io.Writer, headers []string, rows [][]string, opts Options) error {
	// An empty list with no known columns has nothing to show (the caller
	// notes "No results." on stderr).
	if len(headers) == 0 && len(rows) == 0 {
		return nil
	}
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	clean := func(s string) string {
		s = strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\t", " ")
		if !opts.Wide && len([]rune(s)) > maxCellWidth {
			return string([]rune(s)[:maxCellWidth-1]) + "…"
		}
		return s
	}
	if !opts.NoHeaders {
		fmt.Fprintln(tw, strings.Join(headers, "\t"))
	}
	for _, row := range rows {
		cells := make([]string, len(row))
		for i, c := range row {
			cells[i] = clean(c)
		}
		fmt.Fprintln(tw, strings.Join(cells, "\t"))
	}
	return tw.Flush()
}

func writeCSV(w io.Writer, headers []string, rows [][]string, noHeaders bool) error {
	if len(headers) == 0 && len(rows) == 0 {
		return nil
	}
	cw := csv.NewWriter(w)
	if !noHeaders {
		lower := make([]string, len(headers))
		for i, h := range headers {
			lower[i] = strings.ToLower(h)
		}
		if err := cw.Write(lower); err != nil {
			return err
		}
	}
	if err := cw.WriteAll(rows); err != nil {
		return err
	}
	cw.Flush()
	return cw.Error()
}
