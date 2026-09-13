# Threshold alerts

Threshold alerts watch fleet metrics and page you when rules breach — delivered as **Slack Block Kit cards** and/or **email (SMTP)**. Configure under **Admin → Alerting** (`alerting:view`; edits need `alerting:edit`/`alerting:delete`).

## Rule types

| Rule type | Watches |
| --- | --- |
| Node memory % | Server RAM usage per node |
| Per-query memory | Individual queries holding too much memory |
| Long-running queries | Queries exceeding a duration threshold |

Each rule is scoped per connection (cluster) with its own threshold and duration.

## Hysteresis — no flapping

Rules include hysteresis: a rule must *sustain* its breach for the configured duration before firing, and must *recover* for a duration before resolving. This kills the alert-storm noise that makes on-call ignore pages.

## Delivery channels

| Channel | Setup |
| --- | --- |
| **Slack** | Incoming webhook; deliveries are Block Kit cards with the cluster, metric, value and link into the [fleet](/docs/fleet-view/) |
| **Email** | SMTP settings; same content in plain format |

Channels and rules are stored in the alert config file (`ALERT_CONFIG_FILE`, default `/app/data/alert-config.json`) — included in your `/app/data` volume backup (see the [production checklist](/docs/production-checklist/)).

## Auto-RCA on breach

When an alert breaches, the [Fleet Doctor](/docs/ai-fleet-doctor/) can automatically run a root-cause analysis on the affected cluster and deliver the report to the same channels — governed by `DOCTOR_AUTO_RCA_COOLDOWN_MINUTES` so a single incident doesn't trigger repeated scans.

## Suggested starter rules

| Rule | Value |
| --- | --- |
| Node memory | warn at 80 %, sustained 5 min |
| Per-query memory | 25 % of cluster RAM (matches the flame threshold in [query logs](/docs/monitoring-query-logs/)) |
| Long-running query | 10 min, sustained 2 min |
| Replica lag | Watch [cluster activity](/docs/monitoring-cluster-activity/) trends first, then codify |

> **Tip:** Alerts answer "page me"; the [fleet view](/docs/fleet-view/) answers "what's the state right now". Configure both from the same thresholds so they never disagree.
