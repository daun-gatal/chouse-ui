package cli

import "testing"

func TestTruncateList(t *testing.T) {
	got := map[string]any{"incidents": []any{1, 2, 3}}
	truncateList(got, "incidents", 2)
	if n := len(got["incidents"].([]any)); n != 2 {
		t.Fatalf("want 2 incidents, got %d", n)
	}
	truncateList(got, "incidents", 0)
	if n := len(got["incidents"].([]any)); n != 2 {
		t.Fatalf("limit 0 must not truncate, got %d", n)
	}
}

func TestSplitTable(t *testing.T) {
	db, table := splitTable("shop.orders.v2")
	if db != "shop" || table != "orders.v2" {
		t.Fatalf("got %q %q", db, table)
	}
}

func TestRemediationDecisionsAreGuarded(t *testing.T) {
	root := NewRoot("test", "", "")
	for _, verb := range []string{"approve", "reject"} {
		cmd, _, err := root.Find([]string{"remediation", verb})
		if err != nil || cmd.Name() != verb {
			t.Fatalf("remediation %s missing: %v", verb, err)
		}
		if cmd.Flags().Lookup("comment") == nil {
			t.Errorf("remediation %s needs --comment", verb)
		}
	}
	if cmd, _, _ := root.Find([]string{"remediation", "run"}); cmd != nil && cmd.Name() == "run" {
		t.Error("remediation run must stay out of the CLI: execution follows approval server-side")
	}
}
