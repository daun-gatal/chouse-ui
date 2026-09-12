package cli

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
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

func TestNoColorFlagRemoved(t *testing.T) {
	// --no-color was dead (nothing emits color); it must stay gone so the
	// flag set never re-grows a misleading no-op.
	root := NewRoot("test", "", "")
	if root.PersistentFlags().Lookup("no-color") != nil {
		t.Error("--no-color must not exist (removed: output is always plain)")
	}
}

func TestNoShorthandCollisions(t *testing.T) {
	// A local shorthand must never shadow a persistent one: on commands
	// declaring their own --connection, `-c` errored instead of working.
	// (LocalFlags() includes persistent flags, so skip anything owned by
	// this command's or an ancestor's PersistentFlags.)
	root := NewRoot("test", "", "")
	persistent := map[string]string{}
	root.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		if f.Shorthand != "" {
			persistent[f.Shorthand] = f.Name
		}
	})
	isPersistent := func(c *cobra.Command, name string) bool {
		for p := c; p != nil; p = p.Parent() {
			if p.PersistentFlags().Lookup(name) != nil {
				return true
			}
		}
		return false
	}
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		seen := map[string]string{}
		c.LocalFlags().VisitAll(func(f *pflag.Flag) {
			if isPersistent(c, f.Name) {
				return
			}
			if f.Shorthand != "" {
				if prev, dup := seen[f.Shorthand]; dup {
					t.Errorf("%s: duplicate local shorthand -%s (%s vs %s)", c.Name(), f.Shorthand, prev, f.Name)
				}
				seen[f.Shorthand] = f.Name
				if global, shadow := persistent[f.Shorthand]; shadow {
					t.Errorf("%s: local -%s (%s) shadows persistent --%s", c.Name(), f.Shorthand, f.Name, global)
				}
			}
		})
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(root)
}

func TestTokenFlagSingleCanonicalName(t *testing.T) {
	root := NewRoot("test", "", "")
	auth, _, err := root.Find([]string{"auth", "login"})
	if err != nil || auth == nil || auth.Name() != "login" {
		t.Fatalf("auth login not found: %v", err)
	}
	if auth.Flags().Lookup("token") == nil {
		t.Error("auth login must accept --token (single canonical PAT flag)")
	}
	pat := auth.Flags().Lookup("pat")
	if pat == nil {
		t.Error("auth login must keep --pat as a deprecated alias")
	} else if pat.Deprecated == "" {
		t.Error("--pat must be marked deprecated in favor of --token")
	}
}

func TestScheduledPreviewNeedsConnectionFlag(t *testing.T) {
	root := NewRoot("test", "", "")
	sched, _, err := root.Find([]string{"scheduled", "preview"})
	if err != nil || sched == nil || sched.Name() != "preview" {
		t.Fatalf("scheduled preview not found: %v", err)
	}
	// --connection is the single global flag (inherited): a command-local
	// duplicate used to shadow it, breaking `-c`.
	if sched.InheritedFlags().Lookup("connection") == nil {
		t.Error("scheduled preview must inherit global --connection (server requires connectionId)")
	}
	if sched.Flags().Lookup("query") == nil {
		t.Error("scheduled preview must accept --query (SELECT to validate)")
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

func TestHelpCompleteness(t *testing.T) {
	// Every helpable command must carry guidance (Long) and runnable
	// examples (Example). Only cobra-generated help/completion are exempt —
	// walking the tree (not a roster) forces future commands to comply too.
	root := NewRoot("test", "", "")
	exempt := map[string]bool{"help": true, "completion": true, "bash": true, "fish": true, "powershell": true, "zsh": true}
	count := 0
	var walk func(c *cobra.Command, path string)
	walk = func(c *cobra.Command, path string) {
		name := path + " " + c.Name()
		if !exempt[c.Name()] {
			count++
			if strings.TrimSpace(c.Long) == "" {
				t.Errorf("%s: missing Long guidance", strings.TrimSpace(name))
			}
			if strings.TrimSpace(c.Example) == "" {
				t.Errorf("%s: missing Example", strings.TrimSpace(name))
			} else if !strings.Contains(c.Example, "chouse ") {
				t.Errorf("%s: Example must show real invocations", strings.TrimSpace(name))
			}
		}
		for _, sub := range c.Commands() {
			walk(sub, name)
		}
	}
	walk(root, "")
	if count < 80 {
		t.Errorf("walked only %d commands, tree shrank unexpectedly", count)
	}
}
