package output

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestResolveAutoFollowsTheTerminal(t *testing.T) {
	cases := []struct {
		requested string
		terminal  bool
		want      string
	}{
		{"", true, Table},
		{"", false, JSON},
		{"auto", true, Table},
		{"auto", false, JSON},
		{"YAML", true, YAML},
		{"csv", false, CSV},
		{"table", false, Table},
	}
	for _, c := range cases {
		got, err := Resolve(c.requested, c.terminal)
		if err != nil || got != c.want {
			t.Errorf("Resolve(%q, %v) = %q, %v; want %q", c.requested, c.terminal, got, err, c.want)
		}
	}
	if _, err := Resolve("xml", true); err == nil || !strings.Contains(err.Error(), "json") {
		t.Errorf("unknown formats must fail with the accepted list, got %v", err)
	}
}

func render(t *testing.T, value any, view View, opts Options) string {
	t.Helper()
	var buf bytes.Buffer
	if err := Print(&buf, value, view, opts); err != nil {
		t.Fatalf("Print: %v", err)
	}
	return buf.String()
}

var sessions = map[string]any{
	"sessions": []any{
		map[string]any{"id": "s1", "source": "mcp", "queries": float64(3), "detail": map[string]any{"x": 1}},
		map[string]any{"id": "s2", "source": "pat", "queries": float64(10)},
	},
}

func TestJSONAndYAMLPrintTheWholeValue(t *testing.T) {
	out := render(t, sessions, View{Columns: []Column{{Header: "id"}}}, Options{Format: JSON})
	var back map[string]any
	if err := json.Unmarshal([]byte(out), &back); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	if len(back["sessions"].([]any)) != 2 {
		t.Fatalf("JSON must not be projected: %s", out)
	}
	if y := render(t, sessions, View{}, Options{Format: YAML}); !strings.Contains(y, "source: mcp") {
		t.Fatalf("YAML: %s", y)
	}
}

func TestTableFindsTheOnlyListAndAutoColumns(t *testing.T) {
	out := render(t, sessions, View{}, Options{Format: Table})
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 3 {
		t.Fatalf("want header + 2 rows, got:\n%s", out)
	}
	if !strings.HasPrefix(lines[0], "ID") || !strings.Contains(lines[0], "SOURCE") || strings.Contains(lines[0], "DETAIL") {
		t.Fatalf("auto columns must be scalar fields with id first: %q", lines[0])
	}
}

func TestTableUsesExplicitColumnsAndPaths(t *testing.T) {
	value := []any{map[string]any{"user": map[string]any{"email": "a@x"}, "ok": true}}
	out := render(t, value, View{Columns: []Column{{Header: "email", Path: "user.email"}, {Header: "ok"}}}, Options{Format: Table, NoHeaders: true})
	if strings.TrimSpace(out) != "a@x  true" {
		t.Fatalf("got %q", out)
	}
}

func TestTableShowsAnObjectAsFields(t *testing.T) {
	out := render(t, map[string]any{"name": "prod", "port": float64(8123)}, View{}, Options{Format: Table})
	if !strings.Contains(out, "FIELD") || !strings.Contains(out, "name   prod") || !strings.Contains(out, "8123") {
		t.Fatalf("got:\n%s", out)
	}
}

func TestTableTruncatesLongCellsUnlessWide(t *testing.T) {
	long := strings.Repeat("x", 100)
	value := []any{map[string]any{"sql": long}}
	if out := render(t, value, View{}, Options{Format: Table}); strings.Contains(out, long) || !strings.Contains(out, "…") {
		t.Fatalf("narrow table must truncate: %s", out)
	}
	if out := render(t, value, View{}, Options{Format: Table, Wide: true}); !strings.Contains(out, long) {
		t.Fatalf("--wide must keep the cell")
	}
}

func TestCSVQuotesAndKeepsFullCells(t *testing.T) {
	value := []any{map[string]any{"name": "a,b", "n": float64(1.5)}}
	out := render(t, value, View{Columns: []Column{{Header: "name"}, {Header: "n"}}}, Options{Format: CSV})
	if out != "name,n\n\"a,b\",1.5\n" {
		t.Fatalf("got %q", out)
	}
}

func TestNormalizeHandlesTypedValues(t *testing.T) {
	type row struct {
		Name string `json:"name"`
	}
	out := render(t, []row{{Name: "q"}}, View{}, Options{Format: Table, NoHeaders: true})
	if strings.TrimSpace(out) != "q" {
		t.Fatalf("got %q", out)
	}
}

func TestEmptyListsPrintNothingWithoutKnownColumns(t *testing.T) {
	for _, format := range []string{Table, CSV} {
		if out := render(t, []any{}, View{}, Options{Format: format}); out != "" {
			t.Errorf("%s: want no output for an empty list, got %q", format, out)
		}
	}
	// With curated columns the header still prints.
	if out := render(t, []any{}, View{Columns: []Column{{Header: "id"}}}, Options{Format: Table}); strings.TrimSpace(out) != "ID" {
		t.Errorf("curated columns keep the header: %q", out)
	}
	if Rows([]any{}, View{}) != 0 || Rows([]any{map[string]any{"a": 1.0}}, View{}) != 1 {
		t.Error("Rows")
	}
}

func TestRecordsWithAListAreShownAsFields(t *testing.T) {
	// A job carrying channelIds must not be mistaken for a list of channels.
	job := map[string]any{"id": "j1", "name": "daily", "enabled": true, "frequency": "manual", "channelIds": []any{}}
	out := render(t, job, View{}, Options{Format: Table})
	if !strings.Contains(out, "FIELD") || !strings.Contains(out, "daily") {
		t.Fatalf("got:\n%s", out)
	}
	// A small wrapper of one list plus scalar metadata is a list.
	wrapper := map[string]any{"queries": []any{map[string]any{"query_id": "q"}}, "total": 1.0}
	if out := render(t, wrapper, View{}, Options{Format: Table, NoHeaders: true}); strings.TrimSpace(out) != "q" {
		t.Fatalf("wrapper: %q", out)
	}
}
