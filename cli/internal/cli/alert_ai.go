package cli

import (
	"net/url"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

func (a *App) newAlertCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "alert",
		Short: "Alert channels, rules and deliveries",
		Long: `Inspect alerting: channels (secrets masked), rules and recent
deliveries. test sends a real notification, so it asks first (or needs
--yes). Editing rules and channels stays in the UI.`,
		Example: `  chouse alert channels
  chouse alert events --limit 10
  chouse alert test 51b0… --yes`,
	}
	simple := func(use, short, path string) *cobra.Command {
		return &cobra.Command{
			Use:     use,
			Short:   short,
			Example: "  chouse alert " + use,
			Args:    cobra.NoArgs,
			RunE: a.action(needAuth, func(s *Session, _ []string) error {
				got, err := s.Client.Get(s.Ctx, path, nil)
				if err != nil {
					return err
				}
				return s.Print(got, output.View{})
			}),
		}
	}
	var limit int
	events := &cobra.Command{
		Use:     "events",
		Short:   "Recent alert deliveries, newest first",
		Example: `  chouse alert events --limit 10`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			q := url.Values{}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			got, err := s.Client.Get(s.Ctx, "/api/alerting/events", q)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	events.Flags().IntVar(&limit, "limit", 50, "max events")
	test := &cobra.Command{
		Use:     "test <channelId>",
		Short:   "Send a test notification through a channel",
		Example: `  chouse alert test 51b0… --yes`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("alert test"); err != nil {
				return err
			}
			if err := s.confirm("send a test notification through channel", args[0]); err != nil {
				return err
			}
			got, err := s.Client.Post(s.Ctx, "/api/alerting/channels/"+url.PathEscape(args[0])+"/test", map[string]any{})
			if err != nil {
				return err
			}
			s.audit("alert.test", args[0], "alerting:edit")
			return s.Print(got, output.View{})
		}),
	}
	cmd.AddCommand(simple("channels", "Notification channels (secrets masked)", "/api/alerting/channels"), simple("rules", "Alert rules", "/api/alerting/rules"), events, test)
	return cmd
}

func (a *App) newAICmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ai",
		Short: "Chouse AI on SQL: optimize and diagnose (LLM cost)",
		Long: `Ask Chouse AI to optimize or diagnose SQL. Advisory only — it never
runs anything — but it calls the AI model (LLM cost), so it asks first (or
needs --yes). Listing capabilities and models is free.`,
		Example: `  chouse ai optimize -f slow.sql --yes
  chouse ai optimize --capability debug-query "SELECT …" --yes
  chouse ai models`,
	}
	var file, model, capability string
	var stdin bool
	optimize := &cobra.Command{
		Use:     "optimize [sql]",
		Short:   "Optimize or diagnose SQL (LLM cost)",
		Example: `  chouse ai optimize -f slow.sql --yes -o json`,
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := a.rejectDryRun("ai optimize"); err != nil {
				return err
			}
			sql, err := a.readSQL(file, stdin, args)
			if err != nil {
				return err
			}
			if err := s.confirm("ask Chouse AI ("+capability+")", summarizeSQL(sql)); err != nil {
				return err
			}
			body := map[string]any{"capability": capability, "input": map[string]any{"query": sql}}
			if model != "" {
				body["modelId"] = model
			}
			got, err := s.Client.Post(s.Ctx, "/api/ai/invoke", body)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	optimize.Flags().StringVarP(&file, "file", "f", "", "read SQL from a file (- for stdin)")
	optimize.Flags().BoolVar(&stdin, "stdin", false, "read SQL from stdin")
	optimize.Flags().StringVar(&model, "model", "", "AI model id")
	optimize.Flags().StringVar(&capability, "capability", "optimize-query", "optimize-query|debug-query|diagnose-error|diagnose-parts|diagnose-schema")

	list := func(use, short, path string) *cobra.Command {
		return &cobra.Command{
			Use:     use,
			Short:   short,
			Example: "  chouse ai " + use,
			Args:    cobra.NoArgs,
			RunE: a.action(needAuth, func(s *Session, _ []string) error {
				got, err := s.Client.Get(s.Ctx, path, nil)
				if err != nil {
					return err
				}
				return s.Print(got, output.View{})
			}),
		}
	}
	cmd.AddCommand(optimize, list("capabilities", "What Chouse AI can do for your token", "/api/ai/capabilities"), list("models", "Active AI models", "/api/ai/models"))
	return cmd
}
