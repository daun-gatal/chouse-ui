package cli

import (
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

var (
	actionToolsView    = view("tools", "NAME", "TIER", "TOOLKIT", "TITLE")
	actionActivityView = view("actions", "ID", "TOOL", "TIER", "STATUS", "ORIGIN", "DESCRIPTION")
)

// parseActionArgs turns key=value pairs (values parsed as JSON when they
// are, strings otherwise) and an optional --args JSON object into one map.
func parseActionArgs(pairs []string, raw string) (map[string]any, error) {
	args := map[string]any{}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			return nil, usagef("--args is not a JSON object: %v", err)
		}
	}
	for _, pair := range pairs {
		key, value, ok := strings.Cut(pair, "=")
		if !ok || key == "" {
			return nil, usagef("argument %q is not key=value", pair)
		}
		var parsed any
		if err := json.Unmarshal([]byte(value), &parsed); err == nil {
			args[key] = parsed
		} else {
			args[key] = value
		}
	}
	return args, nil
}

// needsConfirmation reports whether the server asked for a confirmation.
func needsConfirmation(err error) bool {
	var apiErr *api.Error
	return errors.As(err, &apiErr) && apiErr.Code == "CONFIRMATION_REQUIRED"
}

func (a *App) newActionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "action",
		Aliases: []string{"actions"},
		Short:   "AI write tools: list, run, status, undo, activity",
		Long: `The same write tools the CHouse Assistant and MCP agents use (ADR 0025),
checked the same way. An undoable change runs at once; a change that asks
once prompts on a terminal (or needs --yes); a high-risk change is always
sent to a second person to approve in CHouse — --yes never covers it.
Your token's write policy decides which tools you get.`,
		Example: `  chouse action tools
  chouse action run create_saved_query name=orders query="SELECT 1"
  chouse action run run_sql_change sql="INSERT INTO db.t VALUES (1)" --yes
  chouse action undo 3f2a…`,
	}

	tools := &cobra.Command{
		Use:     "tools",
		Short:   "List the write tools your token may run, with how each is checked",
		Example: `  chouse action tools -o json`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/ai-actions/tools", nil)
			if err != nil {
				return err
			}
			return s.Print(got, actionToolsView)
		}),
	}

	var rawArgs string
	run := &cobra.Command{
		Use:   "run <tool> [key=value ...]",
		Short: "Run one write tool",
		Long: `Values are JSON when they parse as JSON (numbers, booleans, arrays,
objects) and strings otherwise; --args takes a whole JSON object.`,
		Example: `  chouse action run pause_scheduled_job id=3f2a…
  chouse action run create_dashboard --args '{"title":"Ingest","panels":[…]}'`,
		Args: cobra.MinimumNArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("action run"); err != nil {
				return err
			}
			toolArgs, err := parseActionArgs(args[1:], rawArgs)
			if err != nil {
				return err
			}
			body := map[string]any{"tool": args[0], "args": toolArgs, "confirmed": s.yes}
			var got map[string]any
			err = s.Client.DoJSON(s.Ctx, "POST", "/api/ai-actions/run", nil, body, &got)
			if needsConfirmation(err) {
				var apiErr *api.Error
				errors.As(err, &apiErr)
				if err := s.confirm("run "+args[0], strings.TrimPrefix(apiErr.Message, "Confirm: ")); err != nil {
					return err
				}
				body["confirmed"] = true
				err = s.Client.DoJSON(s.Ctx, "POST", "/api/ai-actions/run", nil, body, &got)
			}
			if err != nil {
				return err
			}
			if got["submitted"] == true {
				s.notef("Sent for a second person's approval: chouse action status %v", got["actionId"])
			}
			s.audit("action.run", args[0], "ai:act")
			return s.Print(got, output.View{})
		}),
	}
	run.Flags().StringVar(&rawArgs, "args", "", "the tool's arguments as one JSON object")

	status := &cobra.Command{
		Use:     "status <id>",
		Short:   "Show one action: its status, result and whether it can be undone",
		Example: `  chouse action status 3f2a…`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := s.Client.Get(s.Ctx, "/api/ai-actions/"+url.PathEscape(args[0]), nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}

	undo := &cobra.Command{
		Use:     "undo <id>",
		Short:   "Undo an undoable action (within 24 hours, unless it changed since)",
		Example: `  chouse action undo 3f2a… --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("action undo"); err != nil {
				return err
			}
			if err := s.confirm("undo action", args[0]); err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, "/api/ai-actions/"+url.PathEscape(args[0])+"/undo", map[string]any{})
			if err != nil {
				return err
			}
			s.audit("action.undo", args[0], "ai:chat")
			return s.Print(got, output.View{})
		}),
	}

	var limit int
	activity := &cobra.Command{
		Use:     "activity",
		Short:   "What AI agents changed for you, newest first",
		Example: `  chouse action activity --limit 20`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			query := url.Values{}
			if limit > 0 {
				query.Set("limit", strconv.Itoa(limit))
			}
			got, err := s.Client.Get(s.Ctx, "/api/ai-actions/activity", query)
			if err != nil {
				return err
			}
			return s.Print(got, actionActivityView)
		}),
	}
	activity.Flags().IntVar(&limit, "limit", 50, "max actions (1-200)")

	cmd.AddCommand(tools, run, status, undo, activity)
	return cmd
}
