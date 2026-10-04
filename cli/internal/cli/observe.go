package cli

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"github.com/daun-gatal/chouse-ui/cli/internal/output"
)

func (a *App) newLineageCmd() *cobra.Command {
	var direction string
	var depth int
	var impact bool
	cmd := &cobra.Command{
		Use:   "lineage <database.table>",
		Short: "Where a table's data comes from and where it goes",
		Long: `Lineage around one table, built from ClickHouse metadata, query
logs and scheduled jobs. --impact lists everything downstream that a change
to the table would affect (what schema preflight checks before DDL).`,
		Example: `  chouse lineage shop.orders -c prod
  chouse lineage shop.orders --direction up --depth 2
  chouse lineage shop.orders --impact`,
		Args: cobra.ExactArgs(1),
		RunE: a.action(needAuth, func(s *Session, args []string) error {
			db, table, err := splitTable(args[0])
			if err != nil {
				return err
			}
			if direction != "up" && direction != "down" && direction != "both" {
				return usagef("--direction must be up, down or both")
			}
			q := s.connectionQuery()
			q.Set("node", "table:"+db+"."+table)
			path := "/api/observe/lineage"
			if impact {
				path = "/api/observe/lineage/impact"
			} else {
				q.Set("direction", direction)
				q.Set("depth", itoa(depth))
			}
			got, err := s.Client.Get(s.Ctx, path, q)
			if err != nil {
				return err
			}
			if impact {
				return s.Print(got, output.View{})
			}
			return s.Print(got, view("nodes", "ID", "KIND", "LABEL", "STATUS"))
		}),
	}
	cmd.Flags().StringVar(&direction, "direction", "both", "up, down or both")
	cmd.Flags().IntVar(&depth, "depth", 3, "hops to follow (1-8)")
	cmd.Flags().BoolVar(&impact, "impact", false, "list what a change to the table would affect")
	return cmd
}

func (a *App) newIncidentsCmd() *cobra.Command {
	var all bool
	var limit int
	cmd := &cobra.Command{
		Use:   "incidents",
		Short: "Data and pipeline incidents with their root cause",
		Long: `Incidents from Data Health promises and the observability platform
(pipelines, freshness, volume, parts, replication) with severity, subject
and root cause. Active only unless --all; scoped to -c when given.`,
		Example: `  chouse incidents
  chouse incidents --all --limit 20 -o json`,
		Args: cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			q := s.connectionQuery()
			if all {
				q.Set("status", "all")
			}
			got, err := s.Client.Get(s.Ctx, "/api/observe/incidents", q)
			if err != nil {
				return err
			}
			return s.Print(limitList(got, "incidents", limit), view("incidents", "ID", "SOURCE", "STATUS", "SEVERITY", "KIND", "OPENED=openedAt", "TITLE", "ROOT CAUSE=rootCause"))
		}),
	}
	cmd.Flags().BoolVar(&all, "all", false, "include recovered incidents")
	cmd.Flags().IntVar(&limit, "limit", 50, "max rows")
	return cmd
}

func (a *App) newRemediationCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "remediation",
		Aliases: []string{"fixes"},
		Short:   "Review, approve or reject proposed fixes",
		Long: `Fixes proposed for incidents (by people, Chouse AI or MCP agents)
from the remediation catalog. Approving is how a fix gets to run: high-impact
actions need two approvers and nobody approves their own proposal — the
server enforces both. approve and reject ask first (or need --yes).`,
		Example: `  chouse remediation list -c prod --status proposed
  chouse remediation get 6e0b…
  chouse remediation approve 6e0b… --comment "checked the plan" --yes`,
	}
	var status string
	var limit int
	list := &cobra.Command{
		Use:     "list",
		Short:   "Actions on the -c connection, newest first",
		Example: `  chouse remediation list -c prod --status proposed,approved`,
		Args:    cobra.NoArgs,
		RunE: a.action(needAuth, func(s *Session, _ []string) error {
			if err := s.requireConnection("remediation list"); err != nil {
				return err
			}
			q := s.connectionQuery()
			if status != "" {
				q.Set("status", status)
			}
			got, err := s.Client.Get(s.Ctx, "/api/remediation/actions", q)
			if err != nil {
				return err
			}
			return s.Print(limitList(got, "actions", limit), view("actions", "ID", "STATUS", "TYPE", "CLASS=approvalClass", "TITLE", "PROPOSED BY=proposedBy", "CREATED=createdAt"))
		}),
	}
	list.Flags().StringVar(&status, "status", "", "comma-separated: proposed, approved, executing, executed, verified, failed_verification, failed, rolled_back, rejected")
	list.Flags().IntVar(&limit, "limit", 50, "max rows")

	get := a.getCmd("get <actionId>", "One action: statements, approvals, executions", "  chouse remediation get 6e0b… -o yaml", cobra.ExactArgs(1),
		func(args []string) string { return "/api/remediation/actions/" + url.PathEscape(args[0]) }, output.View{})

	var comment string
	decide := func(verb, permission string) *cobra.Command {
		title := strings.ToUpper(verb[:1]) + verb[1:]
		c := &cobra.Command{
			Use:   verb + " <actionId>",
			Short: title + " a proposed action",
			Long: fmt.Sprintf(`%s one proposed action — review it with get first. The server enforces
the approval rules and records the decision with channel=cli.`, title),
			Example: fmt.Sprintf("  chouse remediation %s 6e0b… --comment \"reviewed\" --yes", verb),
			Args:    cobra.ExactArgs(1),
			RunE: a.action(needAuth, func(s *Session, args []string) error {
				if err := a.rejectDryRun("remediation " + verb); err != nil {
					return err
				}
				if err := s.confirm(verb+" remediation", args[0]); err != nil {
					return err
				}
				body := map[string]any{}
				if comment != "" {
					body["comment"] = comment
				}
				got, err := s.Client.Post(s.Ctx, "/api/remediation/actions/"+url.PathEscape(args[0])+"/"+verb, body)
				if err != nil {
					return err
				}
				s.audit("remediation."+verb, args[0], permission)
				return s.Print(got, output.View{})
			}),
		}
		c.Flags().StringVar(&comment, "comment", "", "decision comment")
		return c
	}
	cmd.AddCommand(list, get, decide("approve", "remediation:approve"), decide("reject", "remediation:approve|remediation:propose"))
	return cmd
}
