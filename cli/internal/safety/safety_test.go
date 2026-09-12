package safety

import (
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
	// /dev/null is non-TTY: without --yes this must refuse.
	f, err := openDevNull()
	if err != nil {
		t.Skip("no /dev/null")
	}
	defer f.Close()
	err = RequireConfirm(ConfirmOptions{Action: "drop", Target: "db.t", In: f})
	if err == nil {
		t.Fatal("non-TTY without --yes must fail closed")
	}
	if err := RequireConfirm(ConfirmOptions{Action: "drop", Target: "db.t", Yes: true, In: f}); err != nil {
		t.Fatalf("--yes must approve: %v", err)
	}
}
