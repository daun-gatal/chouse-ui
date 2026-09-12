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
