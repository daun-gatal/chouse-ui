---
app: Admin › Alerting
route: /admin/alerting
permissions: alerting:view
---
# Alerting

**Admin › Alerting** turns [fleet](/docs/fleet/) samples into alerts: you define where alerts go (**notification channels**), what triggers them (**alert rules**), and see what fired (**recent alerts**). Editing needs `alerting:edit`; deleting needs `alerting:delete`.

## Notification channels

**Add channel**, give it a name, pick a type and switch it **Enabled**:

| Type | Needs |
| --- | --- |
| **Slack** | An incoming webhook URL |
| **Google Chat** | A space webhook URL |
| **Email** | SMTP host, port, TLS, username, password, optional *from*, and recipients |
| **Webhook** | An endpoint URL and an optional bearer secret (sent as `Authorization: Bearer …`) |

**Send test** delivers a test message so you know the channel works before you rely on it.

Channels are shared: [promises](/docs/data-health/) can also notify them on incident changes.

## Alert rules

**Add rule**, then:

1. **Name** and **Severity** (*info*, *warning* or *critical*).
2. **Thresholds** — set any of these; `0` turns one off:

   | Threshold | Fires when |
   | --- | --- |
   | **Node mem %** | A node's memory use exceeds this percentage |
   | **Query GB** | A single query holds more than this much memory |
   | **Query min** | A single query has run longer than this many minutes |
   | **Parts ETA min** | A table is projected to reach `parts_to_throw_insert` (inserts start failing with *too many parts*) within this many minutes |

3. **Deliver to channels** — one or more channels.
4. Optionally **AI auto-RCA on breach** with a **Model**: when the rule fires, the [Doctor](/docs/doctor/) investigates the affected connection and sends its report to the same channels, at most once per `DOCTOR_AUTO_RCA_COOLDOWN_MINUTES` (default 60) per server.

Only one fleet rule can be active at a time; disable the current one before enabling another.

## How alerts fire

Rules are checked on every fleet sample (`OBSERVE_FLEET_INTERVAL`, default 30 s). An alert fires once when a condition goes from healthy to breaching, and doesn't repeat while it stays breached; the state survives pod restarts and failover, so a rollout doesn't re-send everything. A parts-pressure alert re-arms only once the projected time climbs well clear of the limit, to avoid flapping.

**Recent alerts** lists what fired. Clear entries older than 24 hours, 7 days or 30 days, or all of them.

> **Note:** Before 3.14, channels and rules lived in `ALERT_CONFIG_FILE`. That file is imported into the database once on upgrade; after that, manage everything here.

## Suggested starting rules

| Threshold | Start with |
| --- | --- |
| Node mem % | 85 |
| Query GB | About a quarter of a node's RAM |
| Query min | 10 |
| Parts ETA min | 60 |

Tune them after a week of watching [Fleet](/docs/fleet/) trends, so alerts and the dashboard agree.
