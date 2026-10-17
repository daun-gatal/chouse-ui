package cli

import (
	"errors"
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

// aiRequestOrigins are the values of `ai requests --origin`.
var aiRequestOrigins = []string{"ui", "mcp", "token", "background"}

// notebookKinds maps `notebook <kind>` to what the server attaches notebooks to.
var notebookKinds = map[string]string{
	"data-health": "incident_data_health",
	"observe":     "incident_observe",
	"doctor":      "doctor_report",
}

func oneOf(value string, allowed []string) bool {
	for _, a := range allowed {
		if value == a {
			return true
		}
	}
	return false
}

// newAIUsageCmds are the read-only `ai` subcommands about CHouse's own AI:
// what it used and cost, what it sent to providers, and how it is set up.
func (a *App) newAIUsageCmds() []*cobra.Command {
	var days int
	windowQuery := func() (url.Values, error) {
		if days < 1 {
			return nil, usagef("--days must be 1 or more (the server caps it at its retention)")
		}
		q := url.Values{}
		q.Set("days", itoa(days))
		return q, nil
	}

	var by string
	usage := &cobra.Command{
		Use:   "usage",
		Short: "What CHouse's AI used and cost (tokens, est. cost, data sent)",
		Long: `CHouse's own AI (the chat and every AI feature) in the last --days:
requests, tokens, estimated cost over priced models, ClickHouse read by AI
tools and rows sent to LLM providers. --by origin splits it by who started
the requests (the UI, MCP agents, access tokens, background); --by model
shows usage per model. With ai_usage:view it covers everyone, otherwise only
your own requests (the "scope" field says which).`,
		Example: `  chouse ai usage --days 30
  chouse ai usage --by origin
  chouse ai usage --by model -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if by != "" && by != "origin" && by != "model" {
				return usagef("--by must be origin or model")
			}
			q, err := windowQuery()
			if err != nil {
				return err
			}
			if by == "model" {
				got, err := s.Client.Get(s.Ctx, "/api/ai-usage/models", q)
				if err != nil {
					return err
				}
				return s.Print(got, output.View{List: "models", Columns: []output.Column{
					{Header: "model", Path: "name"}, {Header: "provider", Path: "providerType"}, {Header: "requests"}, {Header: "calls"},
					{Header: "in", Path: "inputTokens"}, {Header: "out", Path: "outputTokens"}, {Header: "cost $", Path: "costUsd"}, {Header: "priced", Path: "hasPrice"},
				}})
			}
			got, err := s.Client.Get(s.Ctx, "/api/ai-usage/summary", q)
			if err != nil {
				return err
			}
			if by == "origin" {
				return s.Print(got, view("byOrigin", "ORIGIN", "REQUESTS", "IN=inputTokens", "OUT=outputTokens", "COST $=costUsd"))
			}
			return s.Print(got, output.View{})
		}),
	}
	usage.Flags().StringVar(&by, "by", "", "origin or model")

	var egressQ string
	egress := &cobra.Command{
		Use:   "egress",
		Short: "Tables, columns and records AI tools sent to LLM providers",
		Long: `Data CHouse's AI tools returned to an LLM provider in the last --days,
by source (a table or a CHouse record type), most rows first: columns, rows,
bytes, users, requests and providers. --search narrows the sources on the
server.`,
		Example: `  chouse ai egress --days 30
  chouse ai egress --search customers`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			q, err := windowQuery()
			if err != nil {
				return err
			}
			if egressQ != "" {
				q.Set("q", egressQ)
			}
			got, err := s.Client.Get(s.Ctx, "/api/ai-usage/egress", q)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{List: "sources", Columns: []output.Column{
				{Header: "kind"}, {Header: "source"}, {Header: "rows"}, bytesCol("bytes", "bytes"), {Header: "users"}, {Header: "requests"}, {Header: "providers"},
			}})
		}),
	}
	egress.Flags().StringVar(&egressQ, "search", "", "only sources whose name contains this text")

	var reqQ, origin string
	var limit, offset int
	requests := &cobra.Command{
		Use:   "requests",
		Short: "Recent AI requests: who started them, tokens, cost, status",
		Long: `AI requests of the last --days, newest first: the user, where it came
from (--origin ui, mcp, token or background), the token and client of MCP
and token requests, the agent, tokens, estimated cost, ClickHouse read and
status. Prompt and response text are never stored.`,
		Example: `  chouse ai requests --origin mcp
  chouse ai requests --search ci-agent --limit 20
  chouse ai requests --days 30 -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if origin != "" && !oneOf(origin, aiRequestOrigins) {
				return usagef("--origin must be one of %s", strings.Join(aiRequestOrigins, ", "))
			}
			if limit < 1 || limit > 200 {
				return usagef("--limit must be between 1 and 200")
			}
			if offset < 0 {
				return usagef("--offset must be 0 or more")
			}
			q, err := windowQuery()
			if err != nil {
				return err
			}
			q.Set("limit", itoa(limit))
			q.Set("offset", itoa(offset))
			if reqQ != "" {
				q.Set("q", reqQ)
			}
			if origin != "" {
				q.Set("origin", origin)
			}
			got, err := s.Client.Get(s.Ctx, "/api/ai-usage/requests", q)
			if err != nil {
				return err
			}
			return s.Print(got, view("requests", "ID", "STARTED=startedAt", "USER=userName", "ORIGIN", "CLIENT=clientName", "TOKEN=patName",
				"AGENT=agentName", "IN=inputTokens", "OUT=outputTokens", "COST $=costUsd", "STATUS"))
		}),
	}
	requests.Flags().StringVar(&reqQ, "search", "", "match on user, agent, feature, client, token name or a table sent to the model")
	requests.Flags().StringVar(&origin, "origin", "", "only requests started from ui, mcp, token or background")
	requests.Flags().IntVar(&limit, "limit", 50, "rows to return (1-200)")
	requests.Flags().IntVar(&offset, "offset", 0, "rows to skip, for paging")

	request := a.getCmd("request <requestId>", "One AI request step by step: LLM calls, tool calls, queries, data sent", "  chouse ai request 0c5f… -o yaml", cobra.ExactArgs(1),
		func(args []string) string { return "/api/ai-usage/requests/" + url.PathEscape(args[0]) },
		view("steps", "#=seq", "KIND", "NAME", "AGENT=agentPath", "IN=inputTokens", "OUT=outputTokens", "COST $=costUsd", "QUERIES=chQueries", "STATUS"))

	agents := a.getCmd("agents", "CHouse's AI agents: what each feature runs, models, tools (ai_agents:view)", "  chouse ai agents\n  chouse ai agents -o json | jq '.features'", cobra.NoArgs,
		func([]string) string { return "/api/ai-agents/registry" },
		view("agents", "ID", "SLUG", "NAME", "KIND", "ENABLED", "BUILT IN=isSystem", "CUSTOMIZED", "UPDATE=updateAvailable", "MODEL=modelConfigId", "HARNESS=harnessId"))
	agents.Long = `The AI agents CHouse runs (AI Governance › Assistant): each agent with
its model config, harness, tools, skills and subagents, whether it is built
in or customized and has an update, and which agent each AI feature is bound
to (-o json for features, harnesses and skills). Read-only; agents are edited
in the UI.`

	guardrails := a.getCmd("guardrails", "AI guardrails: what every AI run passes through (ai_guardrails:view)", "  chouse ai guardrails\n  chouse ai guardrails -o json | jq '.guardrails[] | select(.enabled)'", cobra.NoArgs,
		func([]string) string { return "/api/ai-guardrails" },
		view("guardrails", "ID", "NAME", "KIND", "STAGES", "ACTION", "MODE", "ENABLED", "BUILT IN=isSystem", "CUSTOMIZED", "TRIGGERS 24H=triggers24h.total"))
	guardrails.Long = `The guardrails CHouse applies to its AI runs and, where enabled, to MCP
tool results (AI Governance › Guardrails): kind, stages, action, shadow or
enforce mode, whether it is on, and its triggers in the last 24 hours.
Read-only; guardrails are edited in the UI or the REST API.`

	var guardrailID string
	var triggerLimit, triggerOffset int
	triggers := &cobra.Command{
		Use:   "guardrail-triggers",
		Short: "Recent guardrail triggers: stage, action, matches, agent and tool",
		Long: `Guardrail triggers of the last --days, newest first: the guardrail, the
stage, the action and mode, how many values matched, the agent and tool, and
the AI request. Matched values are never stored.`,
		Example: `  chouse ai guardrail-triggers
  chouse ai guardrail-triggers --guardrail builtin-guardrail-pii --days 7
  chouse ai guardrail-triggers --limit 50 --offset 50`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if triggerLimit < 1 || triggerLimit > 500 {
				return usagef("--limit must be between 1 and 500")
			}
			if triggerOffset < 0 {
				return usagef("--offset must be 0 or more")
			}
			q, err := windowQuery()
			if err != nil {
				return err
			}
			q.Set("limit", itoa(triggerLimit))
			q.Set("offset", itoa(triggerOffset))
			if guardrailID != "" {
				q.Set("guardrailId", guardrailID)
			}
			got, err := s.Client.Get(s.Ctx, "/api/ai-guardrails/events", q)
			if err != nil {
				return err
			}
			return s.Print(got, view("events", "TIME=createdAt", "GUARDRAIL=guardrailName", "STAGE", "ACTION", "MODE", "MATCHES=matchCount", "SOURCE", "AGENT=agentPath", "TOOL", "REQUEST=requestId"))
		}),
	}
	triggers.Flags().StringVar(&guardrailID, "guardrail", "", "only this guardrail's triggers (id from `chouse ai guardrails`)")
	triggers.Flags().IntVar(&triggerLimit, "limit", 100, "rows to return (1-500)")
	triggers.Flags().IntVar(&triggerOffset, "offset", 0, "rows to skip, for paging")

	for _, c := range []*cobra.Command{usage, egress, requests, triggers} {
		c.Flags().IntVar(&days, "days", 7, "window in days (capped at the server's retention)")
	}
	return []*cobra.Command{usage, egress, requests, request, agents, guardrails, triggers}
}

func (a *App) newPerfCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "perf",
		Short: "Query regressions against their own baseline",
		Long: `Query shapes on the -c connection that got slower or heavier than
their own baseline, lined up with the upgrades, DDL and setting changes
around their onset (Monitoring › Performance). Sample query text needs
query:history:view:all.`,
		Example: `  chouse perf regressions -c prod
  chouse perf shape 9f2c41d0a1b2 -c prod`,
	}
	regressions := &cobra.Command{
		Use:     "regressions",
		Short:   "Open regressions, worst first",
		Example: `  chouse perf regressions -c prod -o json`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if err := s.requireConnection("perf regressions"); err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/observe/performance", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, view("regressions", "FINGERPRINT", "REPLICA", "METRIC", "BASELINE", "CURRENT", "RATIO", "RUNS", "ONSET=onsetAt"))
		}),
	}
	shape := &cobra.Command{
		Use:     "shape <fingerprint>",
		Short:   "Hourly history of one query shape",
		Example: `  chouse perf shape 9f2c41d0a1b2 -c prod`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := s.requireConnection("perf shape"); err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/observe/performance/fingerprints/"+url.PathEscape(args[0]), s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, output.View{List: "series", Columns: []output.Column{
				{Header: "hour"}, {Header: "replica"}, {Header: "runs"}, {Header: "errors"}, {Header: "p50 ms", Path: "p50"}, {Header: "p95 ms", Path: "p95"},
				bytesCol("read", "readBytes"), {Header: "version", Path: "serverVersion"},
			}})
		}),
	}
	cmd.AddCommand(regressions, shape)
	return cmd
}

func (a *App) newCapacityCmd() *cobra.Command {
	var section string
	cmd := &cobra.Command{
		Use:   "capacity",
		Short: "Disk forecasts, table growth, cold tables and codec trials",
		Long: `Capacity of the -c connection (Monitoring › Capacity): days until each
node's disk reaches its threshold (--view forecasts), the fastest-growing
tables (growth), tables nobody read in 7 days (cold) and codec trials
(trials). -o json shows everything, with cost by consumer when you have
cost:view.`,
		Example: `  chouse capacity -c prod
  chouse capacity -c prod --view growth
  chouse capacity -c prod -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			views := map[string]output.View{
				"forecasts": {List: "forecasts", Columns: []output.Column{
					{Header: "node"}, {Header: "disk"}, {Header: "used", Path: "usedRatio"}, bytesCol("growth/day", "growthPerDay"),
					{Header: "days left", Path: "daysToThreshold"}, {Header: "threshold"},
				}},
				"growth": {List: "growth", Columns: []output.Column{{Header: "database"}, {Header: "table"}, bytesCol("per day", "bytesPerDay")}},
				"cold":   {List: "cold", Columns: []output.Column{{Header: "database"}, {Header: "table"}, bytesCol("size", "totalBytes"), {Header: "last write", Path: "lastWriteAt"}}},
				"trials": {List: "trials", Columns: []output.Column{
					{Header: "database"}, {Header: "table"}, {Header: "column"}, {Header: "current"}, {Header: "candidate"}, {Header: "status"}, bytesCol("saved", "savedBytes"),
				}},
			}
			v, ok := views[section]
			if !ok {
				return usagef("--view must be forecasts, growth, cold or trials")
			}
			if err := s.requireConnection("capacity"); err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/observe/capacity", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, v)
		}),
	}
	cmd.Flags().StringVar(&section, "view", "forecasts", "table to show: forecasts, growth, cold or trials")
	return cmd
}

func (a *App) newUpgradesCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "upgrades",
		Short: "Upgrade readiness, canary replays and rollout gates",
		Long: `Upgrade readiness (Monitoring › Upgrades): assessments of a target
version against your real workload, workload replays on a canary, and the
rollout gates of every connection. Read-only; assessments and replays are
started in the UI.`,
		Example: `  chouse upgrades list -c prod
  chouse upgrades get 3d1e… -o yaml
  chouse upgrades replay 7a90…
  chouse upgrades rollout`,
	}
	list := &cobra.Command{
		Use:     "list",
		Short:   "Assessments and replays of the -c connection",
		Example: `  chouse upgrades list -c prod`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if err := s.requireConnection("upgrades list"); err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/upgrades/assessments", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, view("assessments", "ID", "FROM=currentVersion", "TO=targetVersion", "VERDICT", "CREATED=createdAt"))
		}),
	}
	get := a.getCmd("get <assessmentId>", "One assessment: every rule and its evidence", "  chouse upgrades get 3d1e… -o yaml", cobra.ExactArgs(1),
		func(args []string) string { return "/api/upgrades/assessments/" + url.PathEscape(args[0]) }, output.View{})
	replay := a.getCmd("replay <replayId>", "One canary replay: replayed, skipped, missing and differing queries", "  chouse upgrades replay 7a90…", cobra.ExactArgs(1),
		func(args []string) string { return "/api/upgrades/replays/" + url.PathEscape(args[0]) }, output.View{})
	rollout := a.getCmd("rollout", "Every connection's version and rollout gates", "  chouse upgrades rollout", cobra.NoArgs,
		func([]string) string { return "/api/upgrades/rollout" },
		view("nodes", "CONNECTION=name", "VERSION", "LAG S=gates.replicaLagSeconds", "REGRESSIONS=gates.openRegressions", "SICK=gates.sickReplicas", "CHECKED=checkedAt"))
	cmd.AddCommand(list, get, replay, rollout)
	return cmd
}

func (a *App) newCollectorsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "collectors",
		Short: "Observability collectors: last runs, errors and schedule",
		Long: `The collectors that feed Data, Monitoring and alerting from
ClickHouse system tables. status shows each collector's last run, last
error, missing grants and what it read on the -c connection; schedule shows
how often each runs (the defaults, or the -c connection's own schedule with
its bytes read per day). Read-only; the schedule is edited in Admin ›
Connections.`,
		Example: `  chouse collectors status -c prod
  chouse collectors schedule
  chouse collectors schedule -c prod`,
	}
	status := &cobra.Command{
		Use:     "status",
		Short:   "Each collector's state, last run and last error",
		Example: `  chouse collectors status -c prod`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if err := s.requireConnection("collectors status"); err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/observe/status", s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, output.View{List: "collectors", Columns: []output.Column{
				{Header: "collector"}, {Header: "state"}, {Header: "paused"}, {Header: "last run", Path: "lastRunAt"}, {Header: "last ok", Path: "lastOkAt"},
				bytesCol("read", "readBytes"), {Header: "error", Path: "lastError"},
			}})
		}),
	}
	schedule := &cobra.Command{
		Use:     "schedule",
		Short:   "How often each collector runs (defaults, or the -c connection's)",
		Example: `  chouse collectors schedule -c prod -o json`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			path := "/api/observe/collectors/schedule"
			columns := []output.Column{
				{Header: "collector", Path: "name"}, {Header: "interval s", Path: "effective.intervalSeconds"}, {Header: "from", Path: "effective.intervalSource"},
				{Header: "paused", Path: "effective.paused"},
			}
			if s.Cfg.Connection != "" {
				path += "/" + url.PathEscape(s.Cfg.Connection)
				columns = append(columns, bytesCol("read/day", "projectedBytesPerDay"))
			}
			got, err := s.Client.Get(s.Ctx, path, nil)
			if err != nil {
				return err
			}
			return s.Print(got, output.View{List: "collectors", Columns: columns})
		}),
	}
	cmd.AddCommand(status, schedule)
	return cmd
}

func (a *App) newContextCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "context",
		Short: "Curated table context and metric definitions",
		Long: `What people wrote down about the data on the -c connection (Data ›
Context): a table's description, owner, grain, column notes and caveats,
and the defined business metrics. Read-only; context is edited in the UI.`,
		Example: `  chouse context get shop.orders -c prod
  chouse context metrics -c prod
  chouse context metrics gmv -c prod -o json`,
	}
	get := &cobra.Command{
		Use:     "get <database.table>",
		Short:   "One table's curated context",
		Example: `  chouse context get shop.orders -c prod -o yaml`,
		Args:    cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			db, table, err := splitTable(args[0])
			if err != nil {
				return err
			}
			if err := s.requireConnection("context get"); err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/context/tables/"+url.PathEscape(db)+"/"+url.PathEscape(table), s.connectionQuery())
			if err != nil {
				return err
			}
			return s.Print(got, output.View{})
		}),
	}
	metrics := &cobra.Command{
		Use:     "metrics [name]",
		Short:   "Metric definitions (all, or one by name)",
		Example: `  chouse context metrics gmv -c prod`,
		Args:    cobra.MaximumNArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			if err := s.requireConnection("context metrics"); err != nil {
				return err
			}
			got, err := s.Client.Get(s.Ctx, "/api/context/metrics", s.connectionQuery())
			if err != nil {
				return err
			}
			if len(args) == 1 {
				got = metricNamed(got, args[0])
			}
			return s.Print(got, view("metrics", "NAME", "DATABASE", "TABLE", "EXPRESSION", "DESCRIPTION"))
		}),
	}
	cmd.AddCommand(get, metrics)
	return cmd
}

// metricNamed keeps only the metric called name in a {metrics: [...]} payload.
func metricNamed(value any, name string) any {
	obj, ok := value.(map[string]any)
	if !ok {
		return value
	}
	list, ok := obj["metrics"].([]any)
	if !ok {
		return value
	}
	kept := []any{}
	for _, m := range list {
		if rec, ok := m.(map[string]any); ok && rec["name"] == name {
			kept = append(kept, m)
		}
	}
	obj["metrics"] = kept
	return obj
}

func (a *App) newNotebookCmd() *cobra.Command {
	kinds := "data-health, observe or doctor"
	cmd := &cobra.Command{
		Use:   "notebook",
		Short: "Investigation notebooks of incidents and Doctor reports",
		Long: `The investigation notebook of an incident or Doctor report: Chouse AI
findings, query snapshots, notes and actions. <kind> is data-health (a Data
Health incident), observe (an observability incident, see chouse incidents)
or doctor (a Doctor report). export writes it as a Markdown postmortem to
stdout. Read-only; notebooks are written in the UI.`,
		Example: `  chouse notebook show observe 4b2e…
  chouse notebook export doctor 91fa… > postmortem.md`,
	}
	attachment := func(kind string) (string, error) {
		server, ok := notebookKinds[kind]
		if !ok {
			return "", usagef("<kind> must be %s", kinds)
		}
		return server, nil
	}
	lookup := func(s *Session, kind, ref string) (any, error) {
		server, err := attachment(kind)
		if err != nil {
			return nil, err
		}
		return s.Client.Get(s.Ctx, "/api/notebooks/attached/"+server+"/"+url.PathEscape(ref), nil)
	}
	show := &cobra.Command{
		Use:     "show <kind> <ref>",
		Short:   "A notebook's cells in order",
		Example: `  chouse notebook show data-health 12 -o yaml`,
		Args:    cobra.ExactArgs(2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := lookup(s, args[0], args[1])
			if err != nil {
				return err
			}
			return s.Print(got, view("cells", "#=position", "KIND", "AUTHOR=authorKind", "CREATED=createdAt"))
		}),
	}
	export := &cobra.Command{
		Use:     "export <kind> <ref>",
		Short:   "Write a notebook as a Markdown postmortem to stdout",
		Long:    `Write the notebook as Markdown to stdout (always Markdown; -o does not apply).`,
		Example: `  chouse notebook export observe 4b2e… > postmortem.md`,
		Args:    cobra.ExactArgs(2),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			got, err := lookup(s, args[0], args[1])
			if err != nil {
				return err
			}
			id, ok := lookupString(got, "notebook.id")
			if !ok {
				return errors.New("the server returned no notebook id")
			}
			raw, _, err := s.Client.GetRaw(s.Ctx, "/api/notebooks/"+url.PathEscape(id)+"/export", nil)
			if err != nil {
				return err
			}
			_, err = s.Out.Write(raw)
			return err
		}),
	}
	cmd.AddCommand(show, export)
	return cmd
}

// lookupString reads a string at a dot path of a decoded JSON value.
func lookupString(value any, path string) (string, bool) {
	cur := value
	for _, key := range strings.Split(path, ".") {
		obj, ok := cur.(map[string]any)
		if !ok {
			return "", false
		}
		cur = obj[key]
	}
	s, ok := cur.(string)
	return s, ok && s != ""
}
