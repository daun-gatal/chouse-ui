package cli

import (
	"net/url"

	"github.com/spf13/cobra"
)

func newAlertCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "alert",
		Short: "Alert channels, rules, events (reads; writes guarded)",
		Long: `Inspect alerting configuration and history. Listing is free;
sending a test delivery is a side effect and needs --yes.`,
		Example: `  chouse alert channels
  chouse alert rules -o json
  chouse alert events --limit 5
  chouse alert test ch_abc123 --yes`,
	}
	var limit int

	channels := &cobra.Command{
		Use:   "channels",
		Short: "List notification channels (secrets masked)",
		Long:  `List notification channels. Secrets stay masked server-side — safe to print anywhere.`,
		Example: `  chouse alert channels
  chouse alert channels -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/alerting/channels", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	rules := &cobra.Command{
		Use:   "rules",
		Short: "List alert rules",
		Long:  `List alert rules with their conditions and targets. Read-only — rule edits stay in the browser.`,
		Example: `  chouse alert rules
  chouse alert rules -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/alerting/rules", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	events := &cobra.Command{
		Use:   "events",
		Short: "List alert events",
		Long:  `List recent alert deliveries, newest first, capped at --limit. Start here when a notification didn't arrive.`,
		Example: `  chouse alert events --limit 5
  chouse alert events -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if limit > 0 {
				q.Set("limit", itoa(limit))
			}
			got, err := c.Get(ctx, "/api/alerting/events", q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	events.Flags().IntVar(&limit, "limit", 50, "max events")
	test := &cobra.Command{
		Use:   "test <channelId>",
		Short: "Send a test delivery (side-effect)",
		Long: `Send a real test delivery through a channel. People get paged —
needs --yes outside a TTY like any side effect. Verify the channel id with
alert channels first.`,
		Example: `  chouse alert channels
  chouse alert test ch_abc123 --yes`,
		Args: cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			rejectDryRun("alert test")
			confirmDestructive("alert.test", args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Post(ctx, "/api/alerting/channels/"+args[0]+"/test", map[string]any{})
			if err != nil {
				failErr(err)
			}
			auditLine("alert.test", args[0], "alerting:edit")
			render(resolved, got)
		},
	}
	cmd.AddCommand(channels, rules, events, test)
	return cmd
}

func newAICmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ai",
		Short: "Read-only AI analysis (LLM cost applies)",
		Long: `LLM-powered SQL analysis: optimize or diagnose statements, list
capabilities and models. Reading lists is free; optimize invokes a model
(LLM spend) and needs --yes like any costly action. Feed SQL as args, -f,
or --stdin.`,
		Example: `  chouse ai capabilities
  chouse ai optimize -f slow.sql --yes
  echo "SELECT * FROM big" | chouse ai optimize --stdin --yes -o json`,
	}
	var file, model, capability string
	var stdin bool

	optimize := &cobra.Command{
		Use:   "optimize [sql]",
		Short: "Optimize or diagnose SQL (advisory only, LLM cost applies)",
		Long: `Ask the model to optimize or diagnose SQL. Advisory only — it
prints suggestions, never executes. Invokes a model (LLM spend), so it needs
--yes outside a TTY. Feed SQL as args, -f file, or --stdin.`,
		Example: `  chouse ai optimize "SELECT * FROM big WHERE day = today()" --yes
  chouse ai optimize -f slow.sql --model m_abc --yes -o json`,
		Run: func(_ *cobra.Command, args []string) {
			rejectDryRun("ai optimize")
			confirmDestructive("ai.optimize", "sql")
			c, resolved := mustClient(true)
			sql := readSQLInput(file, stdin, args)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			body := map[string]any{"capability": capability, "input": map[string]any{"query": sql}}
			if model != "" {
				body["modelId"] = model
			}
			got, err := c.Post(ctx, "/api/ai/invoke", body)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	optimize.Flags().StringVarP(&file, "file", "f", "", "read SQL from file")
	optimize.Flags().StringVar(&model, "model", "", "model ID")
	optimize.Flags().StringVar(&capability, "capability", "optimize-query", "optimize-query|debug-query|diagnose-error|diagnose-parts|diagnose-schema")
	optimize.Flags().BoolVar(&stdin, "stdin", false, "read SQL from stdin")

	caps := &cobra.Command{
		Use:   "capabilities",
		Short: "List AI capabilities and your access",
		Long:  `List what the AI backend can do for your token (optimize-query, debug-query, …). Free and read-only.`,
		Example: `  chouse ai capabilities
  chouse ai capabilities -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/ai/capabilities", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	models := &cobra.Command{
		Use:   "models",
		Short: "List active AI models (no secrets)",
		Long:  `List active AI models and the default. No secrets, free to call — pick an id for optimize --model.`,
		Example: `  chouse ai models
  chouse ai models -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/ai/models", nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	cmd.AddCommand(optimize, caps, models)
	return cmd
}
