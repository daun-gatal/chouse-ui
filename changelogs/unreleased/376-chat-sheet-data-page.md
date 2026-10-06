type: patch

### Fixed
- **AI chat sheet width** — the chat sheet now opens wide by default on each device (tablet, laptop, desktop) and keeps only the width you drag it to. The width-cycling button is gone. Older floating-window sizes no longer shrink the sheet, and the header controls stay visible at the minimum width.
- **Parallel AI chats** — starting a new chat while another thread is still answering no longer locks the composer. Each thread runs, stops and shows its status on its own, and a reply that finishes in the background lands in its own thread.
- **Deleted objects on the Data page** — dropped tables and deleted scheduled jobs and saved queries are pruned from lineage, and dropped tables are hidden from capacity growth. Incidents for pipelines that no longer exist are now recovered instead of staying open.
- **False "stopped" pipelines and incidents** — a pipeline is now *stopped* only against a known cadence: a scheduled query's schedule, a refreshable view's interval (`AFTER`, `MONTH` and `RANDOMIZE FOR` included), or a cadence learned from a regular writer. It is no longer judged against a guessed hour. Idle Kafka consumers, quiet tables in a replicated database, dictionaries that reload only on change, and one-off writers no longer show as stopped.
- **Paused pipelines** — disabled scheduled queries and views stopped with `SYSTEM STOP VIEW` now show as *paused* and never open an incident. Pausing a Data Health promise closes its open incidents.
- **Scheduled query status** — a job is judged by its latest run. A failure that a retry fixed no longer opens an incident, and a failed run stays *failing* until the next run succeeds.
- **External table failures** — only errors reaching the external source count. A user's typo or an ad-hoc query that ran out of memory no longer marks the source as failing.
- **Incident flapping** — a pipeline must stay bad for five minutes before it opens an incident. An open incident's summary keeps up with the pipeline, and it recovers as soon as the pipeline is healthy, paused or gone.
- **False stale tables** — a table written by a scheduled query or refreshable view follows that job: it is not stale while the job runs fine or is paused, and when it is stale the reason names the broken job. The parts of one insert count as one write, and nightly or weekend lulls the table has already shown this week no longer mark it stale.
- **Vulnerable dependencies** — `@modelcontextprotocol/sdk` 1.31.0 (OAuth client credential leak), `proxy-addr` 2.0.8 and `source-map-js` 1.2.2.
