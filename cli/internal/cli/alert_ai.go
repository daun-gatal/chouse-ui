package cli

import (
	"net/url"

	"github.com/spf13/cobra"
)

func newAlertCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "alert", Short: "Alert channels, rules, events (reads; writes guarded)"}
	var limit int

	channels := &cobra.Command{
		Use:   "channels",
		Short: "List notification channels (secrets masked)",
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
		Args:  cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
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
	cmd := &cobra.Command{Use: "ai", Short: "Read-only AI analysis (LLM cost applies)"}
	var file, model, capability string
	var stdin bool

	optimize := &cobra.Command{
		Use:   "optimize",
		Short: "Optimize or diagnose SQL (advisory only)",
		Run: func(_ *cobra.Command, args []string) {
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
