package output

import (
	"bytes"
	"strings"
	"testing"
)

func TestPrintJSONStable(t *testing.T) {
	var buf bytes.Buffer
	if err := Print(&buf, "json", map[string]any{"b": 2, "a": 1}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `"a": 1`) {
		t.Fatalf("json output broken: %s", buf.String())
	}
}

func TestPrintTableAndCSV(t *testing.T) {
	rows := []map[string]any{{"name": "db1", "tables": 3}}
	var buf bytes.Buffer
	if err := Print(&buf, "table", rows); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "db1") {
		t.Fatalf("table missing row: %s", buf.String())
	}
	buf.Reset()
	if err := Print(&buf, "csv", rows); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "name") || !strings.Contains(buf.String(), "db1") {
		t.Fatalf("csv broken: %s", buf.String())
	}
}

func TestPrintQueryResultUnwrap(t *testing.T) {
	payload := map[string]any{
		"data": map[string]any{
			"meta": []any{map[string]any{"name": "n"}},
			"data": []any{map[string]any{"n": 42}},
		},
	}
	var buf bytes.Buffer
	if err := Print(&buf, "table", payload); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "42") {
		t.Fatalf("QueryResult unwrap broken: %s", buf.String())
	}
}

func TestPrintUnknownFormat(t *testing.T) {
	var buf bytes.Buffer
	if err := Print(&buf, "xml", "x"); err == nil {
		t.Fatal("expected error for unknown format")
	}
}

func TestToRowsScalarDataPreserved(t *testing.T) {
	// A scalar "data" field next to siblings must render all columns —
	// unwrapping it would silently drop siblings (JSON renders the raw map).
	payload := map[string]any{"id": 1, "data": "x"}
	var buf bytes.Buffer
	if err := Print(&buf, "table", payload); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, "id") || !strings.Contains(out, "x") {
		t.Fatalf("siblings lost: %s", out)
	}
	if strings.Contains(out, "value") {
		t.Fatalf("scalar data must not collapse to value column: %s", out)
	}
}

func TestToRowsNestedDataPreserved(t *testing.T) {
	payload := map[string]any{"id": 1, "data": map[string]any{"x": 1}}
	var buf bytes.Buffer
	if err := Print(&buf, "table", payload); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, "id") || !strings.Contains(out, `{"x":1}`) {
		t.Fatalf("nested data must render whole map with compact cell: %s", out)
	}
}

func TestNestedCellsCompact(t *testing.T) {
	payload := map[string]any{"arr": []any{1, 2}, "obj": map[string]any{"b": 1, "a": 2}, "s": "plain"}
	var buf bytes.Buffer
	if err := Print(&buf, "table", payload); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, "[1,2]") || !strings.Contains(out, `{"a":2,"b":1}`) {
		t.Fatalf("nested cells must be compact sorted JSON: %s", out)
	}
	if strings.Contains(out, "{\n") {
		t.Fatalf("table must never embed a pretty JSON document: %s", out)
	}
}

func TestSingleKeyDataUnwrapUnchanged(t *testing.T) {
	// Legacy single-key wrapper keeps its historic shape.
	var buf bytes.Buffer
	if err := Print(&buf, "table", map[string]any{"data": "x"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "value") {
		t.Fatalf("single-key data wrapper changed shape: %s", buf.String())
	}
}

func TestNestedCellsCSVQuoted(t *testing.T) {
	payload := []map[string]any{{"id": 1, "tags": []any{"a", "b"}}}
	var buf bytes.Buffer
	if err := Print(&buf, "csv", payload); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, `"[""a"",""b""]"`) {
		t.Fatalf("nested CSV cell must be RFC-quoted JSON: %s", out)
	}
}
