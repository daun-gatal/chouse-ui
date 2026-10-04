// Package safety enforces safe-by-default behavior: read-only commands run
// freely, while destructive intent requires explicit confirmation.
package safety

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

var (
	writeVerbs = regexp.MustCompile(`(?i)^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE|ATTACH|DETACH|RENAME|KILL|OPTIMIZE)\b`)
	selectOnly = regexp.MustCompile(`(?i)^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b`)
)

// Intent classifies a SQL statement.
type Intent int

const (
	// IntentRead is SELECT/SHOW/DESCRIBE/EXPLAIN and friends.
	IntentRead Intent = iota
	// IntentWrite is DML/DDL and other mutating statements.
	IntentWrite
	// IntentUnknown fails closed as a write.
	IntentUnknown
)

// Classify returns the intent of one SQL statement (first statement wins;
// multi-statement input is treated as a write).
func Classify(sql string) Intent {
	trimmed := strings.TrimSpace(sql)
	if trimmed == "" {
		return IntentUnknown
	}
	if strings.Count(trimmed, ";") > 1 || (strings.Contains(trimmed, ";") && !strings.HasSuffix(trimmed, ";")) {
		return IntentWrite
	}
	if selectOnly.MatchString(trimmed) {
		return IntentRead
	}
	if writeVerbs.MatchString(trimmed) {
		return IntentWrite
	}
	return IntentUnknown
}

// ConfirmOptions controls destructive gating.
type ConfirmOptions struct {
	// Yes is --yes (non-interactive approval for CI/agents).
	Yes bool
	// Action and Target describe the mutation for the prompt.
	Action string
	Target string
	// In is where the typed answer comes from; Prompt is where the question
	// goes (stderr, so stdout stays clean).
	In     io.Reader
	Prompt io.Writer
	// TTY is whether In is an interactive terminal.
	TTY bool
}

// RequireConfirm enforces a typed "yes" on a terminal or --yes. Without a
// terminal and without --yes it fails closed, so agents and scripts cannot
// mutate by accident.
func RequireConfirm(opts ConfirmOptions) error {
	if opts.Yes {
		return nil
	}
	if !opts.TTY || opts.In == nil {
		return fmt.Errorf("refusing %s on %q without --yes in non-interactive mode (pass --yes to approve, --dry-run to preview where supported)", opts.Action, opts.Target)
	}
	if opts.Prompt != nil {
		fmt.Fprintf(opts.Prompt, "%s %q? This may change data. Type 'yes' to continue: ", opts.Action, opts.Target)
	}
	line, err := bufio.NewReader(opts.In).ReadString('\n')
	if err != nil && strings.TrimSpace(line) == "" {
		return fmt.Errorf("confirm %s: %w", opts.Action, err)
	}
	if strings.TrimSpace(strings.ToLower(line)) != "yes" {
		return errors.New("aborted: confirmation not given")
	}
	return nil
}
