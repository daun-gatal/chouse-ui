package cli

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

func TestCommandTreeComplete(t *testing.T) {
	root := NewRoot("test", "abc", "today")
	want := []string{
		"status", "auth", "config", "connection", "version",
		"query", "table", "saved", "upload",
		"metrics", "logs", "live", "fleet", "scheduled", "alert", "audit",
		"health", "lineage", "incidents", "remediation",
		"ai", "doctor", "agents", "mcp",
	}
	seen := map[string]bool{}
	for _, c := range root.Commands() {
		seen[c.Name()] = true
	}
	for _, w := range want {
		if !seen[w] {
			t.Errorf("missing command %q", w)
		}
	}
}

func TestEveryTopLevelCommandIsGrouped(t *testing.T) {
	root := NewRoot("test", "", "")
	for _, c := range root.Commands() {
		if c.Name() == "help" || c.Name() == "completion" {
			continue
		}
		if c.GroupID == "" {
			t.Errorf("%s has no help group", c.Name())
		}
	}
}

func TestNoStubCommands(t *testing.T) {
	// 1.0 removed commands that only printed "use the UI".
	root := NewRoot("test", "", "")
	for _, path := range [][]string{
		{"table", "create"}, {"table", "drop"}, {"connection", "create"}, {"connection", "delete"},
		{"connection", "use"}, {"upload", "into"}, {"logs", "patterns"}, {"remediation", "run"},
	} {
		if cmd, _, err := root.Find(path); err == nil && cmd.Name() == path[1] {
			t.Errorf("%v must not exist", path)
		}
	}
}

func TestGlobalFlags(t *testing.T) {
	root := NewRoot("test", "", "")
	for _, f := range []string{"yes", "dry-run", "output", "token", "server", "connection", "timeout", "ca-cert", "insecure-skip-tls-verify", "debug", "no-headers", "wide", "quiet", "profile"} {
		if root.PersistentFlags().Lookup(f) == nil {
			t.Errorf("missing global flag --%s", f)
		}
	}
	usage := root.PersistentFlags().Lookup("output").Usage
	for _, format := range []string{"auto", "table", "csv", "json", "yaml"} {
		if !strings.Contains(usage, format) {
			t.Errorf("--output help must list %s: %s", format, usage)
		}
	}
}

func TestNoShorthandCollisions(t *testing.T) {
	// A local shorthand must never shadow a persistent one (-c, -o, -q).
	root := NewRoot("test", "", "")
	persistent := map[string]string{}
	root.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		if f.Shorthand != "" {
			persistent[f.Shorthand] = f.Name
		}
	})
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		c.LocalNonPersistentFlags().VisitAll(func(f *pflag.Flag) {
			if global, shadow := persistent[f.Shorthand]; f.Shorthand != "" && shadow {
				t.Errorf("%s: local -%s (%s) shadows --%s", c.CommandPath(), f.Shorthand, f.Name, global)
			}
		})
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(root)
}

func TestHelpCompleteness(t *testing.T) {
	// Every command has a summary and real examples; command groups also
	// explain themselves. Walking the tree holds future commands to it.
	root := NewRoot("test", "", "")
	exempt := map[string]bool{"help": true, "completion": true, "bash": true, "fish": true, "powershell": true, "zsh": true}
	count := 0
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		if exempt[c.Name()] {
			return
		}
		count++
		if strings.TrimSpace(c.Short) == "" {
			t.Errorf("%s: missing Short", c.CommandPath())
		}
		if !strings.Contains(c.Example, "chouse ") {
			t.Errorf("%s: missing a real Example", c.CommandPath())
		}
		if c.HasSubCommands() && strings.TrimSpace(c.Long) == "" {
			t.Errorf("%s: command groups need Long guidance", c.CommandPath())
		}
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(root)
	if count < 70 {
		t.Errorf("walked only %d commands, tree shrank unexpectedly", count)
	}
}

func TestRemediationDecisionsTakeAComment(t *testing.T) {
	root := NewRoot("test", "", "")
	for _, verb := range []string{"approve", "reject"} {
		cmd, _, err := root.Find([]string{"remediation", verb})
		if err != nil || cmd.Name() != verb || cmd.Flags().Lookup("comment") == nil {
			t.Errorf("remediation %s needs --comment", verb)
		}
	}
}

func TestVersionCompatibility(t *testing.T) {
	cases := map[string]string{"3.14.0": "yes", "v3.15.2": "yes", "3.13.9": "no (needs 3.14.0 or later)", "dev": "unknown (development build)", "3.14.0-rc.1": "yes", "": "unknown (development build)"}
	for in, want := range cases {
		if got := compatibility(in); got != want {
			t.Errorf("compatibility(%q) = %q, want %q", in, got, want)
		}
	}
}
