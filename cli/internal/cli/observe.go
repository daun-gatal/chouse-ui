package cli

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
)

// splitTable parses "db.table" into its parts (exit 2 on bad input).
func splitTable(fq string) (string, string) {
	dot := strings.Index(fq, ".")
	if dot <= 0 || dot == len(fq)-1 {
		fail(api.ExitUsage, fmt.Sprintf("expected <database>.<table>, got %q", fq))
	}
	return fq[:dot], fq[dot+1:]
}

// requireConnection fails fast when a command needs a pinned connection.
func requireConnection(connection, what string) {
	if connection == "" {
		fail(api.ExitUsage, what+" needs a connection: pass -c <connectionId> or set CHOUSE_CONNECTION")
	}
}

// newDatasetHealthCmd is `chouse health dataset` (ADR 0016): one table's trust state.
func newDatasetHealthCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "dataset <database>.<table>",
		Short: "One table's health: trust state, freshness, incidents",
		Long: `Health of one table from the observability platform: trust state
(trusted, degraded, stale, unknown), freshness, volume baseline, open
incidents, owners and recent writers. Check it before relying on a table.`,
		Example: `  chouse health dataset shop.orders
  chouse health dataset shop.orders -c conn_abc -o json`,
		Args: cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			db, table := splitTable(args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/observe/datasets/"+url.PathEscape(db)+"/"+url.PathEscape(table), nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
}

func newLineageCmd() *cobra.Command {
	var direction string
	var depth int
	var impact bool
	cmd := &cobra.Command{
		Use:   "lineage <database>.<table>",
		Short: "Table lineage: sources, views, jobs and downstream tables",
		Long: `Lineage around one table, collected from ClickHouse metadata, query
logs and scheduled jobs. --impact lists everything downstream that a change
to the table would affect (what schema preflight checks before DDL).`,
		Example: `  chouse lineage shop.orders
  chouse lineage shop.orders --direction up --depth 2
  chouse lineage shop.orders --impact -o json`,
		Args: cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			db, table := splitTable(args[0])
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			q.Set("node", "table:"+db+"."+table)
			path := "/api/observe/lineage"
			if impact {
				path = "/api/observe/lineage/impact"
			} else {
				q.Set("direction", direction)
				q.Set("depth", itoa(depth))
			}
			got, err := c.Get(ctx, path, q)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}
	cmd.Flags().StringVar(&direction, "direction", "both", "up|down|both")
	cmd.Flags().IntVar(&depth, "depth", 3, "hops to follow (1..8)")
	cmd.Flags().BoolVar(&impact, "impact", false, "list downstream impact only")
	return cmd
}

func newIncidentsCmd() *cobra.Command {
	var all bool
	var limit int
	cmd := &cobra.Command{
		Use:   "incidents",
		Short: "Data and pipeline incidents with root cause",
		Long: `Incidents from every source — Data Health promises and the
observability platform (pipelines, freshness, volume, parts, replication) —
with severity, subject and the deterministic root-cause summary. Active only
unless --all. Scoped to -c when given, otherwise every connection you can use.`,
		Example: `  chouse incidents
  chouse incidents --all --limit 20 -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			if all {
				q.Set("status", "all")
			}
			if resolved.Connection != "" {
				q.Set("connectionId", resolved.Connection)
			}
			got, err := c.Get(ctx, "/api/observe/incidents", q)
			if err != nil {
				failErr(err)
			}
			truncateList(got, "incidents", limit)
			render(resolved, got)
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "include recovered incidents")
	cmd.Flags().IntVar(&limit, "limit", 50, "max rows (client-side)")
	return cmd
}

// truncateList caps an enveloped list client-side so --limit is honest.
func truncateList(got any, key string, limit int) {
	if limit <= 0 {
		return
	}
	if m, ok := got.(map[string]any); ok {
		if arr, ok := m[key].([]any); ok && len(arr) > limit {
			m[key] = arr[:limit]
		}
	}
}

func newRemediationCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "remediation",
		Short: "Review, approve or reject proposed fixes",
		Long: `Fixes proposed from incidents (by people, Chouse AI or MCP agents)
from the closed remediation catalog. Approving is how a fix gets to run:
high-impact actions need two approvers, and nobody approves their own
proposal. Approve and reject are actions needing --yes.`,
		Example: `  chouse remediation list -c conn_abc
  chouse remediation get act_abc123
  chouse remediation approve act_abc123 --comment "checked the plan" --yes`,
	}
	var status string
	var limit int
	var comment string

	list := &cobra.Command{
		Use:   "list",
		Short: "List actions on a connection",
		Long:  `List remediation actions on the -c connection, newest first. --status filters (comma-separated: proposed, approved, executing, executed, verified, failed_verification, failed, rolled_back, rejected).`,
		Example: `  chouse remediation list -c conn_abc
  chouse remediation list -c conn_abc --status proposed -o json`,
		Run: func(_ *cobra.Command, _ []string) {
			c, resolved := mustClient(true)
			requireConnection(resolved.Connection, "remediation list")
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			q := url.Values{}
			q.Set("connectionId", resolved.Connection)
			if status != "" {
				q.Set("status", status)
			}
			got, err := c.Get(ctx, "/api/remediation/actions", q)
			if err != nil {
				failErr(err)
			}
			truncateList(got, "actions", limit)
			render(resolved, got)
		},
	}
	list.Flags().StringVar(&status, "status", "", "status filter (comma-separated)")
	list.Flags().IntVar(&limit, "limit", 50, "max rows (client-side)")

	get := &cobra.Command{
		Use:     "get <actionId>",
		Short:   "Show one action with its approvals and executions",
		Long:    `Show one action: the exact statements it will run, its approval class, approvals so far and every execution attempt.`,
		Example: `  chouse remediation get act_abc123 -o json`,
		Args:    cobra.ExactArgs(1),
		Run: func(_ *cobra.Command, args []string) {
			c, resolved := mustClient(true)
			ctx, cancel := ctxWithTimeout()
			defer cancel()
			got, err := c.Get(ctx, "/api/remediation/actions/"+url.PathEscape(args[0]), nil)
			if err != nil {
				failErr(err)
			}
			render(resolved, got)
		},
	}

	decide := func(verb string) *cobra.Command {
		return &cobra.Command{
			Use:   verb + " <actionId>",
			Short: strings.ToUpper(verb[:1]) + verb[1:] + " an action (action)",
			Long: fmt.Sprintf(`%s one proposed action. Review it with get first. The server enforces
the approval rules (two approvers for high-impact actions, never the proposer)
and records the decision with channel=cli. Needs --yes outside a TTY.`, strings.ToUpper(verb[:1])+verb[1:]),
			Example: fmt.Sprintf("  chouse remediation %s act_abc123 --comment \"reviewed\" --yes", verb),
			Args:    cobra.ExactArgs(1),
			Run: func(_ *cobra.Command, args []string) {
				rejectDryRun("remediation " + verb)
				confirmDestructive("remediation."+verb, args[0])
				c, resolved := mustClient(true)
				ctx, cancel := ctxWithTimeout()
				defer cancel()
				body := map[string]any{}
				if comment != "" {
					body["comment"] = comment
				}
				got, err := c.Post(ctx, "/api/remediation/actions/"+url.PathEscape(args[0])+"/"+verb, body)
				if err != nil {
					failErr(err)
				}
				permission := "remediation:approve"
				if verb == "reject" {
					permission = "remediation:approve|remediation:propose"
				}
				auditLine("remediation."+verb, args[0], permission)
				render(resolved, got)
			},
		}
	}
	approve := decide("approve")
	reject := decide("reject")
	approve.Flags().StringVar(&comment, "comment", "", "decision comment")
	reject.Flags().StringVar(&comment, "comment", "", "decision comment")

	cmd.AddCommand(list, get, approve, reject)
	return cmd
}
