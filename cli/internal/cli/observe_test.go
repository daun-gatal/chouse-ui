package cli

import "testing"

func TestLimitList(t *testing.T) {
	got := map[string]any{"incidents": []any{1, 2, 3}}
	limitList(got, "incidents", 2)
	if n := len(got["incidents"].([]any)); n != 2 {
		t.Fatalf("want 2, got %d", n)
	}
	limitList(got, "incidents", 0)
	if n := len(got["incidents"].([]any)); n != 2 {
		t.Fatalf("limit 0 must not truncate, got %d", n)
	}
	if list := limitList([]any{1, 2, 3}, "", 1).([]any); len(list) != 1 {
		t.Fatalf("top-level list: %v", list)
	}
}

func TestSplitTable(t *testing.T) {
	db, table, err := splitTable("shop.orders.v2")
	if err != nil || db != "shop" || table != "orders.v2" {
		t.Fatalf("got %q %q %v", db, table, err)
	}
	if _, _, err := splitTable("orders"); err == nil {
		t.Fatal("want an error without a database")
	}
}

func TestFlattenTables(t *testing.T) {
	tree := []any{
		map[string]any{"name": "shop", "children": []any{map[string]any{"name": "orders", "type": "table", "engine": "MergeTree"}}},
		map[string]any{"name": "empty"},
	}
	rows := flattenTables(tree, "")
	if len(rows) != 2 || rows[0].(map[string]any)["table"] != "orders" || rows[1].(map[string]any)["database"] != "empty" {
		t.Fatalf("got %v", rows)
	}
	if rows := flattenTables(tree, "shop"); len(rows) != 1 {
		t.Fatalf("filter: %v", rows)
	}
}
