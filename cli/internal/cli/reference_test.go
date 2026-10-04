package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// The docs site renders the CLI command reference from this snapshot of the
// command tree (docs/portfolio/scripts/gen-reference.ts). The test fails when
// the tree changes without the snapshot, so the published reference can't
// drift from the binary. Regenerate with:
//
//	UPDATE_CLI_REFERENCE=1 go test ./internal/cli -run TestCommandReference
const cliReferencePath = "../../../docs/portfolio/src/content/reference/cli.json"

type refFlag struct {
	Name      string `json:"name"`
	Shorthand string `json:"shorthand,omitempty"`
	Type      string `json:"type"`
	Default   string `json:"default,omitempty"`
	Usage     string `json:"usage"`
}

type refCommand struct {
	Path     string    `json:"path"`
	Use      string    `json:"use"`
	Short    string    `json:"short"`
	Long     string    `json:"long,omitempty"`
	Example  string    `json:"example,omitempty"`
	Aliases  []string  `json:"aliases,omitempty"`
	Group    string    `json:"group,omitempty"`
	Runnable bool      `json:"runnable"`
	Flags    []refFlag `json:"flags,omitempty"`
}

type refGroup struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type cliReference struct {
	GlobalFlags []refFlag    `json:"globalFlags"`
	Groups      []refGroup   `json:"groups"`
	Commands    []refCommand `json:"commands"`
}

func refFlags(set *pflag.FlagSet) []refFlag {
	var out []refFlag
	set.VisitAll(func(f *pflag.Flag) {
		if f.Hidden || f.Name == "help" {
			return
		}
		def := f.DefValue
		if def == "false" || def == "[]" || def == "0s" {
			def = ""
		}
		out = append(out, refFlag{Name: f.Name, Shorthand: f.Shorthand, Type: f.Value.Type(), Default: def, Usage: f.Usage})
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func collectCommands(cmd *cobra.Command, out *[]refCommand) {
	for _, child := range cmd.Commands() {
		if child.Hidden || child.Name() == "help" || child.Name() == "completion" {
			continue
		}
		*out = append(*out, refCommand{
			Path:     child.CommandPath(),
			Use:      child.UseLine(),
			Short:    child.Short,
			Long:     child.Long,
			Example:  child.Example,
			Aliases:  child.Aliases,
			Group:    child.GroupID,
			Runnable: child.Runnable(),
			Flags:    refFlags(child.LocalNonPersistentFlags()),
		})
		collectCommands(child, out)
	}
}

func buildCLIReference() cliReference {
	root := NewRoot("reference", "", "")
	ref := cliReference{GlobalFlags: refFlags(root.PersistentFlags())}
	for _, g := range root.Groups() {
		ref.Groups = append(ref.Groups, refGroup{ID: g.ID, Title: g.Title})
	}
	collectCommands(root, &ref.Commands)
	return ref
}

func TestCommandReference(t *testing.T) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(buildCLIReference()); err != nil {
		t.Fatal(err)
	}
	path := filepath.FromSlash(cliReferencePath)
	if os.Getenv("UPDATE_CLI_REFERENCE") == "1" {
		if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v (regenerate with UPDATE_CLI_REFERENCE=1 go test ./internal/cli -run TestCommandReference)", path, err)
	}
	if !bytes.Equal(got, buf.Bytes()) {
		t.Fatalf("%s is out of date with the command tree; regenerate with UPDATE_CLI_REFERENCE=1 go test ./internal/cli -run TestCommandReference, then run `bun scripts/gen-reference.ts` in docs/portfolio", path)
	}
}
