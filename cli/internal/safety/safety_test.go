package safety

import (
	"bytes"
	"strings"
	"testing"
)

func TestClassify(t *testing.T) {
	reads := []string{"SELECT 1", "  with x as (select 1) select * from x", "SHOW TABLES", "DESCRIBE t", "EXPLAIN SELECT 1"}
	for _, q := range reads {
		if Classify(q) != IntentRead {
			t.Errorf("%q should be read", q)
		}
	}
	writes := []string{"INSERT INTO t VALUES (1)", "DROP TABLE t", "ALTER TABLE t ADD COLUMN x String", "TRUNCATE TABLE t", "SELECT 1; DROP TABLE t", ""}
	for _, q := range writes {
		if Classify(q) == IntentRead {
			t.Errorf("%q should not be read", q)
		}
	}
}

func TestRequireConfirmNonTTYFailsClosed(t *testing.T) {
	if err := RequireConfirm(ConfirmOptions{Action: "drop", Target: "db.t", In: strings.NewReader("yes\n")}); err == nil {
		t.Fatal("non-TTY without --yes must fail closed, even with input")
	}
	if err := RequireConfirm(ConfirmOptions{Action: "drop", Target: "db.t", Yes: true}); err != nil {
		t.Fatalf("--yes must approve: %v", err)
	}
}

func TestRequireConfirmOnATerminal(t *testing.T) {
	var prompt bytes.Buffer
	if err := RequireConfirm(ConfirmOptions{Action: "drop", Target: "db.t", In: strings.NewReader("yes\n"), Prompt: &prompt, TTY: true}); err != nil {
		t.Fatalf("typed yes must approve: %v", err)
	}
	if !strings.Contains(prompt.String(), "drop \"db.t\"") {
		t.Fatalf("prompt: %q", prompt.String())
	}
	if err := RequireConfirm(ConfirmOptions{Action: "drop", Target: "db.t", In: strings.NewReader("y\n"), TTY: true}); err == nil {
		t.Fatal("anything but yes must abort")
	}
	if err := RequireConfirm(ConfirmOptions{Action: "drop", Target: "db.t", In: strings.NewReader("yes"), TTY: true}); err != nil {
		t.Fatalf("yes without a newline (EOF) must approve: %v", err)
	}
}
