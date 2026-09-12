// Package safety enforces safe-by-default behavior: read-only commands run
// freely, while destructive intent requires explicit confirmation.
package safety

import (
	"bufio"
	"errors"
	"fmt"
	"os"
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

// IsWrite reports whether the statement needs --yes confirmation.
func IsWrite(sql string) bool {
	return Classify(sql) != IntentRead
}

// ConfirmOptions controls destructive gating.
type ConfirmOptions struct {
	// Yes is --yes (non-interactive approval for CI/agents).
	Yes bool
	// DryRun prints the plan without executing.
	DryRun bool
	// Action and Target describe the mutation for the prompt/audit line.
	Action string
	Target string
	// In renders the prompt; Out receives the audit line. Tests inject buffers.
	In  *os.File
	Out interface{ Write([]byte) (int, error) }
}

// RequireConfirm enforces TTY confirm or --yes. Non-TTY without --yes fails
// closed so agents cannot accidentally mutate.
func RequireConfirm(opts ConfirmOptions) error {
	if opts.Yes {
		return nil
	}
	if !isTTY(opts.In) {
		return fmt.Errorf("refusing %s on %q without --yes in non-interactive mode (pass --yes to approve, --dry-run to preview)", opts.Action, opts.Target)
	}
	fmt.Printf("%s %q? This may mutate data. Type 'yes' to continue: ", opts.Action, opts.Target)
	reader := bufio.NewReader(stdin(opts.In))
	line, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("confirm %s: %w", opts.Action, err)
	}
	if strings.TrimSpace(strings.ToLower(line)) != "yes" {
		return errors.New("aborted: confirmation not given")
	}
	return nil
}

func stdin(f *os.File) *os.File {
	if f != nil {
		return f
	}
	return os.Stdin
}

func isTTY(f *os.File) bool {
	target := stdin(f)
	info, err := target.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}
