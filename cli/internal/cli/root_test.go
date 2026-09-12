package cli

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func commandNames(root *cobra.Command) []string {
	var out []string
	for _, c := range root.Commands() {
		out = append(out, c.Name())
	}
	return out
}

func TestCommandTreeComplete(t *testing.T) {
	root := NewRoot("test", "abc", "today")
	want := []string{
		"status", "auth", "connection", "query", "table", "saved",
		"metrics", "logs", "live", "fleet", "doctor", "scheduled",
		"health", "alert", "ai", "upload", "audit", "config", "version",
	}
	seen := map[string]bool{}
	for _, c := range root.Commands() {
		seen[c.Name()] = true
	}
	for _, w := range want {
		if !seen[w] {
			t.Errorf("missing command %q (have %v)", w, commandNames(root))
		}
	}
}

func TestGlobalSafetyFlagsExist(t *testing.T) {
	root := NewRoot("test", "", "")
	for _, f := range []string{"yes", "dry-run", "output", "token", "server", "connection", "timeout"} {
		if root.PersistentFlags().Lookup(f) == nil {
			t.Errorf("missing global flag --%s", f)
		}
	}
}

func TestHelpMentionsSafety(t *testing.T) {
	root := NewRoot("test", "", "")
	var sb strings.Builder
	root.SetOut(&sb)
	root.SetArgs([]string{"--help"})
	_ = root.Execute()
	// Long description must promise safe-by-default so agents pick it up.
	if !strings.Contains(root.Long, "Safe-by-default") {
		t.Error("root Long must document safe-by-default")
	}
}
