# What's new in 3.16

3.16 turns dashboards into a canvas you arrange yourself, and makes them answer the next question: what changed, whether a value is normal, and why it spiked. Place and size panels freely, add text and headings, and let Tidy up or Chouse AI lay them out. Charts mark the changes around them, compare with yesterday or last week, and draw the range a value usually falls in. Freeze what you saw in a snapshot, send a digest on a schedule, bring dashboards over from Grafana, and serve heavy panels from a verified rollup.

It also gives CHouse a buddy: **Chobi**, the one place for AI, above every dialog. CHouse's AI can now change most of what the UI can — safely: undoable changes run at once with Undo, others ask once, and high-risk ones need a second person. The chat streams its steps and survives a reload, takes files and skills, and agents remember preferences and team knowledge, investigate incidents on their own, compute over data in a sandbox, and are checked by evals before a change is saved.

**Try it first** — three short guides walk through the new features with screenshots:

| Guide | You will |
| --- | --- |
| [Let Chobi make a change](/docs/guide-first-ai-change/) | Set up AI changes once, then see a change with Undo, one that asks first, and one that needs a second person |
| [Approve from Slack](/docs/guide-approve-from-chat/) | Connect a Slack app channel, send approvals and alerts to it, and act on them with buttons |
| [Build a dashboard on the canvas](/docs/guide-build-a-dashboard/) | Arrange panels, see what changed, explain a spike, and share what you saw |

## Highlights

**A canvas for dashboards** — Drag panels anywhere and resize them from any edge on a 24-column grid; panels never overlap and never go below a readable size. Add **text** panels in Markdown for runbooks and links, and **headings** for sections. **Tidy up** lays a dashboard out in one click: current values in a row at the top, then trends, breakdowns and tables. Every dashboard you already have was converted on upgrade, keeping its panels' order and sizes, and old exports still import. → [The canvas](/docs/dashboards/#the-canvas)

![A dashboard in edit mode on the canvas](/docs/img/app/dashboards-canvas.jpg "Drag, resize, add text and headings, or Tidy up in one click")

**AI picks the chart and the size** — Ask AI now says what each panel is for (a current value, a trend, a breakdown, a ranking, a distribution or the rows) and CHouse picks a fitting chart and lays the panels out by section, so drafts come out tidy. Each draft runs in full first, and a chart that does not suit the result, such as a pie with 40 slices, is flagged with a fix. The review is now full screen with a live preview laid out as it will be saved, works on tablets and phones, and lets you **Refine** the whole draft or **Regenerate** one panel instead of starting over. → [Draft dashboards with AI](/docs/dashboards-ai/)

**What changed, and why it spiked** — Line and area charts mark DDL, upgrades, settings changes, new writers, panel alerts, incidents, fixes and notes along the time axis, each read with your own access. Select a range to zoom, open its slowest queries, add a note, or **Explain this spike**: Chouse AI reads the range, a week earlier, the changes, queries, mutations and merges, and gives the likely cause with its evidence. → [Annotations and notes](/docs/dashboards/#annotations-and-notes)

![Annotation markers along a chart's time axis](/docs/img/app/dashboards-annotations.jpg "Charts mark what changed around them; select a range to zoom, add a note or explain a spike")

**Is this normal?** — **Compare** draws a chart a day or a week earlier, dashed. An **expected range** draws the band a value usually falls in at that hour, from the past 2 to 8 weeks, and a panel alert can fire when it leaves the band. → [Compare and expected ranges](/docs/dashboards/#compare-and-expected-ranges)

**Drill-down and multi-value variables** — Click a bar, point or row to open another dashboard with its variables set, filter this one, or open the table in the explorer. Variables can now hold several values (`col IN {{var.status}}`). → [Drill-down](/docs/dashboards/#drill-down), [Variables](/docs/dashboards/#variables)

**Snapshots, reports and history** — Freeze every chart for a range in a **snapshot** that chosen roles can open, still within their own access. Send a **scheduled report** — a digest of values, ranges, top rows, errors and alerts, with a link to the dashboard at that time — to your notification channels daily or weekly. **Version history** keeps the last 50 saves and restores any of them. → [Snapshots](/docs/dashboards/#snapshots), [Scheduled reports](/docs/dashboards/#scheduled-reports), [Version history](/docs/dashboards/#version-history)

**Panel cost and rollups** — See what each panel reads per run and per hour at its refresh, with heavy panels flagged. A time-bucketed aggregate panel can propose a rollup: an approved fix builds a 1-minute pre-aggregated table, backfills it, and switches the panel only when the results match exactly. → [Panel cost and rollups](/docs/dashboards/#panel-cost-and-rollups)

**Import from Grafana, and a list that scales** — Import a Grafana dashboard and see, panel by panel, what converts, what changed and what was skipped and why before anything is saved. The dashboards list is now one searchable, sortable, paged table with tabs for yours, shared, pinned and templates. → [Import from Grafana](/docs/dashboards/#import-from-grafana)

![Grafana import preview](/docs/img/app/dashboards-grafana-import.jpg "See what converts, what changes and what is skipped before importing")

**Agents and the CLI** — MCP gets `list_dashboard_versions`, `get_dashboard_annotations` and `create_dashboard_snapshot`; the chat can read what changed around a dashboard; and the CLI gets `chouse dashboard versions|restore|snapshot|import-grafana`. → [MCP tools](/docs/mcp-tools/), [CLI](/docs/cli/)

**Meet Chobi** — The chat becomes Chobi, a little character made of the logo's three bars that parks on the screen edge and stays usable above any dialog. **Now** shows what needs a look across all your connections — incidents, failed jobs, unreachable clusters, changes waiting for you — and Chobi points out what's new on its own, a few times an hour at most. **Activity** lists what AI changed for you, with Undo. Ask from anywhere: select text and press Ctrl/⌘ J, drop something on Chobi, or ask about the SQL in your editor. *"Keep an eye on this table until tomorrow"* creates a watch, and **Hand off** turns a conversation into a note for an incident's notebook or an alert channel. → [Chobi](/docs/chobi/)

![Chobi's Now tab](/docs/img/app/chobi-now.jpg "Chobi's Now tab: what needs a look across every connection you can reach")

**AI that acts, checked by tier** — 74 write tools in seven toolkits cover most of CHouse: queries and tables, schedules, Data Health, alerts and incidents, dashboards and context, users and roles. Undoable changes run at once and show **Done · Undo** for 24 hours; changes undo can't reverse ask once — or as one plan for several; privileged or destructive ones (`DROP`, roles, policies) go to a second person who holds the same permission. A production connection makes every change one tier stricter, and some things — passwords, connections, SSO, tokens, guardrails — are never AI's to touch. The same tools come to MCP agents, held while you confirm in CHouse, and to the CLI as `chouse action`. → [Approvals & tiers](/docs/ai-approvals/), [MCP write tools](/docs/mcp/#write-tools), [CLI](/docs/cli/#ai-write-tools)

![An approval card in the chat](/docs/img/app/chobi-approval.jpg "A change undo can't reverse pauses for one approval; undoable ones run and show Undo")

**One assistant that does the work** — CHouse Assistant is now one agent that owns the conversation and every change: it loads the toolkit for your page and others as needed, delegates deep questions to four read-only investigators, plans multi-step changes so you confirm once, and can open a page or put SQL in your editor. It ships with 40 eval cases. → [Chat agents](/docs/ai-chat-agents/)

**A chat that streams** — Each step shows as it happens, **Stop** stops the reply on the server, and a reload or another tab picks a reply up where it is. Send files with a message (CSV, logs, SQL, and images or PDFs for models that read them), and type `/` to give the agent a skill for that message. → [Using the chat](/docs/ai-chat/)

**Memory** — Agents remember what you tell them to keep (*always use UTC*), with Undo, and what your team knows about a connection once an admin approves it. Manage, export or turn off your memories in **AI Governance › Memories**; team notes about a table also show with its context. → [Memory](/docs/ai-memory/)

**Auto-triage** — Turn it on per trigger and an agent investigates new Data Health and Observe incidents, fleet alerts, failed scheduled runs and Doctor findings within a minute: the likely cause goes to the incident's notebook and your alerting channels, any fix it suggests waits for approval, and cooldowns and a daily token budget bound it. → [Auto-triage](/docs/ai-triage/)

**Budgets, fallbacks and evals** — Cap AI spend per feature and per user, per day or month, and stop or switch to a cheaper model when it runs out. Give an agent a fallback model, retries, call caps and prompt caching. Write test cases with expected tools and a judged rubric, run them against a draft, and require a passing score before it can be saved. A harness can give its agents an analysis sandbox that computes over query results without sending the rows to the model. → [Budgets](/docs/ai-usage/#budgets), [Editing agents](/docs/ai-agent-editor/#settings), [Agent evals](/docs/ai-evals/), [Harnesses](/docs/ai-harnesses/#editing-a-harness)

**Act from chat** — Slack and Google Chat channels gain an **App** mode, and Telegram channels arrive. Their messages update themselves — an alert shows *resolved*, a request shows who decided it — and carry buttons: **Acknowledge** and **Snooze 1h** on Data Health alerts, **Approve** and **Reject** on fixes, **Approve** and **Decline** on AI requests. Each press runs as the CHouse user behind it, with the same checks as in CHouse, and each channel can say who may act from it. → [Chat apps](/docs/chat-apps/)

![Adding a Slack channel in App mode](/docs/img/app/admin-alerting-add-channel.jpg "Add channel: platform, connect, test, and who can act from the channel")

**Need You alerts** — Changes waiting for a second approver, background proposals and held MCP calls can go to team channels after a delay, so nobody has to open CHouse to notice them. → [Need You alerts](/docs/chobi/#need-you-alerts)

**Alerting you can look after** — Admin › Alerting becomes Overview, Channels, Rules and Activity: what fires and what failed to send, each channel's health and what uses it, everything that sends alerts in one list, and searchable history with filters. Every feature now sends through one alert format, so every channel type works for every alert. → [Alerting](/docs/alerting/)

![Alerting channels](/docs/img/app/admin-alerting-channels.jpg "Admin › Alerting: each channel's health and what uses it")

**Memory suggestions** — After a conversation goes quiet, Chobi suggests up to three notes worth keeping; save one to your memory or propose it to the team with a click. → [Chobi chat](/docs/chobi/#chat)

## Upgrading from 3.15

Migrations run on start; nothing to run by hand. Check these:

| What changed | What to do |
| --- | --- |
| Existing dashboards are converted to the canvas on start, keeping their panels' order and sizes; exports are now `chouse.dashboard/v2` | Nothing to do in CHouse. Update the `chouse` CLI before applying new exports with it; `chouse.dashboard/v1` files still import |
| Scheduled dashboard reports link back to the dashboard, so they need `PUBLIC_BASE_URL` | Set `PUBLIC_BASE_URL` (Helm `publicBaseUrl`) to CHouse's external URL before creating reports |
| Reports are sent, and expired snapshots deleted, by the Scheduled Queries scheduler | Nothing to do. With `SCHEDULED_QUERIES_ENABLED=false` on web pods, the dedicated scheduler sends them |
| A panel rollup runs with the connection's remediation credential | To use rollups, grant that credential `CREATE TABLE`, `CREATE VIEW`, `INSERT`, `DROP TABLE` and `DROP VIEW` on the panel's database, and `SELECT` on its table |
| A built-in *Spike Explainer* agent and its feature are installed on start | Nothing to do. Explaining a spike needs `ai:optimize` |
| New read-only MCP tools `list_dashboard_versions` and `get_dashboard_annotations` are on by default | Nothing to do; a token only lists them with `dashboards:view`. Switch them off in **AI Governance › MCP** to keep them from agents |
| *Operations Analyst* gets `get_dashboard_annotations` on start | Nothing to do for the built-in agent. If you customized it, it shows **Update available** in **AI Governance › Assistant** |
| *Dashboard Drafter*'s prompt learns Refine and Regenerate on start | Nothing to do for the built-in agent. If you customized it, it shows **Update available** in **AI Governance › Assistant**; until you take it, Refine and Regenerate still work but follow the feedback less closely |
| New permissions: `ai:act` (approve AI actions; Admin, Developer and Super Admin get it), `ai_budgets:manage` and `ai_memories:manage` (Admin and Super Admin) | Grant them to custom roles that should approve AI actions, manage AI budgets or review team memories |
| *ClickHouse Data* gets the action tools and memory on start, *CHouse Assistant* gets memory, and a new *Incident Triager* agent and Auto-triage feature are installed | Nothing to do for the built-in agents. If you customized one, it shows **Update available** in **AI Governance › Assistant**. Users without `ai:act` can still reject actions, not approve them |
| Chat replies stream over Server-Sent Events | If CHouse sits behind a proxy, make sure it doesn't buffer `/api/ai-chat/runs` responses. CHouse sends `X-Accel-Buffering: no` for nginx; otherwise replies still arrive, only in one go |
| Prompt caching is on for Anthropic and Bedrock models | Nothing to do; AI activity shows the savings. Turn it off per agent under **Runtime** |
| Auto-triage, the analysis sandbox and eval thresholds start off | Nothing to do. Turn them on in **AI Governance › Triage**, a harness, or an agent's **Evals** tab |
| The chat moves to *CHouse Assistant*, now one agent with every write tool; *ClickHouse Data* becomes its read-only investigator; *CHouse Admin* is retired | Nothing to do for built-ins. A chat binding you chose stays; a customized *CHouse Admin* stays as it is; agents that delegated to it now delegate to its three specialists |
| Undoable AI changes no longer ask: they run and show Undo | Nothing to do. Users still need `ai:act` for any AI change; mark production connections (**Admin › Connections › Environment**) so changes there ask |
| MCP tokens of users with `ai:act` get Data & Query write tools: undoable ones run, others wait for confirmation in CHouse | To keep a token read-only, open its wrench in **Preferences › Access tokens** and switch its toolkits off, or narrow **AI Governance › MCP › Write tools**. High-risk changes stay off over MCP until an administrator allows them |
| Migration 1.73.0 adds a watch expiry to Data Health promises; the scheduler removes expired watches | Nothing to do: existing promises are permanent |
| Migration 1.74.0 adds a log of every message sent to a channel and fills in where each past alert came from | Nothing to do |
| Buttons in chat call back to CHouse at `PUBLIC_BASE_URL` | To use them, set `PUBLIC_BASE_URL` (Helm `publicBaseUrl`) to an https address the chat platform can reach, and let `/api/integrations/*` through your ingress. Without it, chat apps still post and update their messages |
| The remediation Slack bot set by `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` and `REMEDIATION_SLACK_CHANNEL` | Nothing to do; it keeps working. To post proposals to other channels or platforms, pick them in **Admin › Alerting › Rules › Remediation approvals** |
| Need You alerts start off; memory suggestions start on, one AI call per quiet conversation | Turn alerts on, or suggestions off, in **AI Governance › Assistant › Chobi**. A built-in *Memory Suggester* agent is installed on start |
| Fleet alert emails use the shared alert layout, and Slack alert text is escaped | Nothing to do. Webhook JSON bodies are unchanged; mentions such as `<!channel>` inside alert text no longer ping |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
