package output

import (
	"bytes"
	"encoding/json"
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

func TestPrintEmptyFormatDefaultsToJSON(t *testing.T) {
	// No --output anywhere must land on JSON: the machine contract default.
	var buf bytes.Buffer
	if err := Print(&buf, "", map[string]any{"a": 1}); err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(buf.Bytes(), &decoded); err != nil {
		t.Fatalf("empty format must render valid JSON: %v (%s)", err, buf.String())
	}
	if decoded["a"] != float64(1) {
		t.Fatalf("default render reshaped the payload: %s", buf.String())
	}
}

func TestPrintYAML(t *testing.T) {
	var buf bytes.Buffer
	if err := Print(&buf, "yaml", map[string]any{"b": 2, "a": 1}); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, "a: 1") || !strings.Contains(out, "b: 2") {
		t.Fatalf("yaml output broken: %s", out)
	}
	if strings.Contains(out, "{") {
		t.Fatalf("yaml must not be JSON: %s", out)
	}
}

func TestPrintUnknownFormat(t *testing.T) {
	var buf bytes.Buffer
	if err := Print(&buf, "xml", "x"); err == nil {
		t.Fatal("expected error for unknown format")
	}
}

func TestPrintTableAndCSVRemoved(t *testing.T) {
	// table/csv were removed, not deprecated: every resolution path must
	// fail fast instead of rendering a legacy format.
	for _, format := range []string{"table", "csv"} {
		var buf bytes.Buffer
		err := Print(&buf, format, []map[string]any{{"name": "db1"}})
		if err == nil {
			t.Fatalf("format %q must be rejected", format)
		}
		if !strings.Contains(err.Error(), "want json|yaml") {
			t.Fatalf("format %q error must point at json|yaml: %v", format, err)
		}
		if buf.Len() != 0 {
			t.Fatalf("format %q must write nothing: %s", format, buf.String())
		}
	}
}
