# Set up your first promise

Every table already has a learned baseline. A **promise** adds what *you* know: "orders are loaded by 07:00", "no order id appears twice". This guide sets up a freshness promise with an alert. You need `data_health:edit`.

## 1. Pick the table

Start with a table that people rely on. **Data › Coverage › Suggested promises** lists read-heavy tables without one — **Accept** opens the wizard pre-filled. Or open the table in **Data › Datasets** and choose **New promise**.

## 2. Describe the dataset

- **Table or view**, or a read-only **dataset query** when you need joins or casts.
- **Event-time column** — the column that says when each row happened (e.g. `created_at`). Windowed checks need it; if it holds integers or text, pick the stored format.
- Optional **row filter** to scope a shared table, e.g. one environment.

## 3. Choose when to evaluate

- **Daily** at a UTC hour, **Weekly**, **Monthly**, **Custom cron**, or **Manual only**.
- **After a scheduled query succeeds** — best when a CHouse UI [scheduled query](/docs/scheduled-queries/) loads the table: the promise checks right after each load.

## 4. Add checks

For a first promise, one **Freshness** check (newest row no older than, say, 2 hours) and one **Row count** or **Volume anomaly** check cover most silent failures. The **AI coverage advisor** can propose a draft from the schema and recent data (needs `ai:optimize`) — review it before applying.

Mark each check *warning* or *critical*, and set **Alert after breaches** / **Recover after passes** so one late batch doesn't page anyone.

## 5. Get notified

Under **Notify on incident transitions**, pick a channel. No channels yet? Add one in **Admin › Alerting** and **Send test**.

## 6. Validate and save

**Validate before activation** checks access, shows the generated SQL and the next evaluation times. Save. The promise shows *unknown* until its first evaluation, then *healthy*, *degraded* or *unhealthy*. A breach opens an incident on **Data › Incidents**.

Run it once by hand to see it work (needs `data_health:run`), or from a script: `chouse health run <promiseId>`.
