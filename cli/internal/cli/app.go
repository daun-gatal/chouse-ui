// Package cli implements the chouse command tree (cobra).
//
// Every command returns an error instead of exiting; Run maps errors to the
// exit-code contract in one place, so commands are testable in-process and
// deferred cleanup always runs. Output goes through the App's streams.
package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/config"
	"github.com/daun-gatal/chouse-ui/cli/internal/output"
	"github.com/daun-gatal/chouse-ui/cli/internal/safety"
)

// ExitInterrupted is returned when the user interrupts a command (Ctrl-C).
const ExitInterrupted = 130

// Streams are the process's standard streams plus whether they are
// terminals; tests inject buffers.
type Streams struct {
	In     io.Reader
	Out    io.Writer
	Err    io.Writer
	InTTY  bool
	OutTTY bool
}

// StdStreams returns the real process streams.
func StdStreams() Streams {
	return Streams{In: os.Stdin, Out: os.Stdout, Err: os.Stderr, InTTY: isTerminal(os.Stdin), OutTTY: isTerminal(os.Stdout)}
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// App holds the streams, build info and global flag values for one run.
type App struct {
	Streams
	version, commit, date string

	server     string
	token      string
	profile    string
	connection string
	output     string
	caCert     string
	timeout    int
	quiet      bool
	yes        bool
	dryRun     bool
	insecure   bool
	debug      bool
	noHeaders  bool
	wide       bool
}

// ExitError carries an exit code with its message.
type ExitError struct {
	Code int
	Err  error
	// Hint is printed on its own line after the error.
	Hint string
}

func (e *ExitError) Error() string { return e.Err.Error() }
func (e *ExitError) Unwrap() error { return e.Err }

func usagef(format string, args ...any) error {
	return &ExitError{Code: api.ExitUsage, Err: fmt.Errorf(format, args...)}
}

func authf(format string, args ...any) error {
	return &ExitError{Code: api.ExitAuth, Err: fmt.Errorf(format, args...)}
}

// Run executes args and returns the process exit code.
func Run(ctx context.Context, args []string, streams Streams, version, commit, date string) int {
	app := &App{Streams: streams, version: version, commit: commit, date: date}
	root := app.newRoot()
	root.SetArgs(args)
	root.SetIn(streams.In)
	root.SetOut(streams.Out)
	root.SetErr(streams.Err)
	return app.report(root.ExecuteContext(ctx))
}

// report prints err and maps it to the exit-code contract.
func (a *App) report(err error) int {
	if err == nil {
		return api.ExitOK
	}
	if errors.Is(err, context.Canceled) {
		fmt.Fprintln(a.Err, "interrupted")
		return ExitInterrupted
	}
	var exitErr *ExitError
	if errors.As(err, &exitErr) {
		fmt.Fprintln(a.Err, "error: "+exitErr.Error())
		if exitErr.Hint != "" {
			fmt.Fprintln(a.Err, "hint: "+exitErr.Hint)
		}
		return exitErr.Code
	}
	var apiErr *api.Error
	if errors.As(err, &apiErr) {
		fmt.Fprintln(a.Err, "error: "+apiErr.Error())
		if apiErr.RequestID != "" {
			fmt.Fprintln(a.Err, "request id: "+apiErr.RequestID)
		}
		if hint := hintFor(apiErr); hint != "" {
			fmt.Fprintln(a.Err, "hint: "+hint)
		}
		return apiErr.ExitCode()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		fmt.Fprintln(a.Err, "error: timed out (raise --timeout, max 600s)")
		return api.ExitNetwork
	}
	// Anything else comes from cobra's argument and flag parsing.
	fmt.Fprintln(a.Err, "error: "+err.Error())
	return api.ExitUsage
}

func hintFor(err *api.Error) string {
	switch {
	case err.StatusCode == 401:
		return "the token is missing, expired or revoked: chouse auth login"
	case err.StatusCode == 403:
		return "your token lacks the permission above: check chouse auth whoami"
	case err.Code == "MCP_DISABLED":
		return "an administrator can turn MCP on in the UI under AI Governance › MCP"
	case err.Code == "NETWORK_ERROR":
		return "check the server address (chouse auth status) and your network; --debug shows each request"
	}
	return ""
}

// timeoutSecs normalizes --timeout so the context deadline and the HTTP
// client cap never disagree.
func (a *App) timeoutSecs() int {
	if a.timeout <= 0 || a.timeout > 600 {
		return 60
	}
	return a.timeout
}

// config resolves settings for commands that need no server.
func (a *App) config() (config.Resolved, error) {
	resolved, err := config.Resolve(config.Flags{
		Server:     a.server,
		Token:      a.token,
		Connection: a.connection,
		Profile:    a.profile,
		Output:     a.output,
		CACert:     a.caCert,
		Insecure:   a.insecure,
	})
	if err != nil {
		return resolved, usagef("%v", err)
	}
	return resolved, nil
}

// outputOptions resolves --output against the terminal.
func (a *App) outputOptions(resolved config.Resolved) (output.Options, error) {
	format, err := output.Resolve(resolved.Output, a.OutTTY)
	if err != nil {
		return output.Options{}, usagef("%v", err)
	}
	return output.Options{Format: format, NoHeaders: a.noHeaders, Wide: a.wide}, nil
}

// notef writes a human note to stderr unless --quiet.
func (a *App) notef(format string, args ...any) {
	if !a.quiet {
		fmt.Fprintf(a.Err, format+"\n", args...)
	}
}

// Session is what an action runs with: a context bound to --timeout and
// Ctrl-C, the resolved config, and (when needed) an authenticated client.
type Session struct {
	*App
	Ctx    context.Context
	Cfg    config.Resolved
	Client *api.Client
	out    output.Options
}

type need int

const (
	needNothing need = iota // local commands
	needServer              // public server endpoints
	needAuth                // a PAT too
)

// action wraps a handler with config resolution, client construction,
// connection lookup and a bounded context.
func (a *App) action(n need, fn func(s *Session, args []string) error) func(*cobra.Command, []string) error {
	return func(cmd *cobra.Command, args []string) error {
		resolved, err := a.config()
		if err != nil {
			return err
		}
		opts, err := a.outputOptions(resolved)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(cmd.Context(), time.Duration(a.timeoutSecs())*time.Second)
		defer cancel()
		s := &Session{App: a, Ctx: ctx, Cfg: resolved, out: opts}
		if n >= needServer {
			if err := resolved.RequireServer(); err != nil {
				return &ExitError{Code: api.ExitUsage, Err: err}
			}
			if n == needAuth {
				if err := resolved.RequireToken(); err != nil {
					return &ExitError{Code: api.ExitAuth, Err: err}
				}
			}
			s.Client, err = a.newClient(resolved, resolved.Token)
			if err != nil {
				return err
			}
			if n == needAuth {
				if err := s.resolveConnection(); err != nil {
					return err
				}
			}
		}
		return fn(s, args)
	}
}

// newClient builds a client with the timeout, TLS trust and debug tracing
// applied. Every command goes through it.
func (a *App) newClient(resolved config.Resolved, token string) (*api.Client, error) {
	c := api.New(resolved.Server, token, resolved.Connection)
	c.UserAgent = "chouse-cli/" + a.version
	c.HTTP.Timeout = time.Duration(a.timeoutSecs()) * time.Second
	if resolved.InsecureSkipTLSVerify {
		fmt.Fprintln(a.Err, "warning: TLS certificate verification is disabled (--insecure-skip-tls-verify)")
	}
	if err := c.ConfigureTLS(api.TLSOptions{CACertFile: resolved.CACert, InsecureSkipVerify: resolved.InsecureSkipTLSVerify}); err != nil {
		return nil, usagef("%v", err)
	}
	if a.debug {
		c.EnableDebug(a.Err)
	}
	return c, nil
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// resolveConnection lets -c take a connection name: anything that is not a
// UUID is looked up among the connections this token can use.
func (s *Session) resolveConnection() error {
	ref := s.Cfg.Connection
	if ref == "" || uuidPattern.MatchString(ref) {
		return nil
	}
	var conns []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := s.Client.DoJSON(s.Ctx, "GET", "/api/rbac/connections/my", nil, nil, &conns); err != nil {
		return err
	}
	var matches []string
	for _, c := range conns {
		if c.ID == ref {
			return nil
		}
		if strings.EqualFold(c.Name, ref) {
			matches = append(matches, c.ID)
		}
	}
	switch len(matches) {
	case 1:
		s.Cfg.Connection = matches[0]
		s.Client.ConnectionID = matches[0]
		return nil
	case 0:
		names := make([]string, 0, len(conns))
		for _, c := range conns {
			names = append(names, c.Name)
		}
		return &ExitError{Code: api.ExitUsage, Err: fmt.Errorf("no connection named %q", ref), Hint: "your connections: " + strings.Join(names, ", ") + " (chouse connection list)"}
	default:
		return &ExitError{Code: api.ExitUsage, Err: fmt.Errorf("%d connections are named %q", len(matches), ref), Hint: "pass the connection id instead: " + strings.Join(matches, ", ")}
	}
}

// Print renders a result in the session's output format. An empty table or
// CSV says so on stderr, so an empty stdout is never ambiguous.
func (s *Session) Print(value any, view output.View) error {
	if err := output.Print(s.Out, value, view, s.out); err != nil {
		return err
	}
	if (s.out.Format == output.Table || s.out.Format == output.CSV) && output.Rows(value, view) == 0 {
		s.notef("No results.")
	}
	return nil
}

// confirm gates a mutation: --yes, or a typed "yes" on a terminal.
func (s *Session) confirm(action, target string) error {
	err := safety.RequireConfirm(safety.ConfirmOptions{
		Yes:    s.yes,
		Action: action,
		Target: target,
		In:     s.In,
		Prompt: s.Err,
		TTY:    s.InTTY,
	})
	if err != nil {
		return usagef("%v", err)
	}
	return nil
}

// audit prints the mutation correlation line.
func (s *Session) audit(action, target, permission string) {
	s.notef("action=%s target=%s permission=%s", action, target, permission)
}

// rejectDryRun fails fast for mutations with no preview, so --dry-run --yes
// never silently executes.
func (a *App) rejectDryRun(what string) error {
	if a.dryRun {
		return usagef("--dry-run is not supported for %s (it always executes; omit --dry-run or use a preview command)", what)
	}
	return nil
}
