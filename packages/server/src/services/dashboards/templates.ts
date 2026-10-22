/**
 * Curated dashboard templates (ADR 0021 §8, ADR 0023 §4). Code, not data: "Use
 * template" copies one into a dashboard the user owns. Every query reads
 * `system.*` tables present on any ClickHouse with default config, leaves
 * CHouse's own traffic out of `query_log`, and bounds every log read by
 * {{from}}/{{to}}. Templates name their sections and panels only; the layout
 * engine places them, as it does AI drafts.
 *
 * templates.test.ts validates and lints each one; templates.e2e.test.ts runs
 * each query on a real ClickHouse.
 */

import { NOT_OBSERVE } from "../observe/clickhouse";
import { arrange, roleOf, type ArrangeSection, type Importance } from "./layout";
import { DEFAULT_ANNOTATION_SOURCES, type DashboardInput, type PanelInput, type VizSpec } from "./spec";

export interface DashboardTemplate {
  id: string;
  title: string;
  description: string;
  /** Which built-in view offers "Open as dashboard" for this template, if any. */
  openFrom: "performance" | "capacity" | null;
  /** A copy is assigned to the connection it is made on (routes). */
  dashboard: Omit<DashboardInput, "connectionScope">;
}

const BUCKET = "toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND)";
const IN_RANGE = "event_time >= {{from}} AND event_time < {{to}}";
const FAILED = "type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')";

function viz(type: VizSpec["type"], x: string | null, y: string[], unit: VizSpec["unit"], extra: Partial<VizSpec> = {}): VizSpec {
  return { version: 2, type, x, y, series: null, unit, decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null, ...extra };
}

const stat = (y: string, unit: VizSpec["unit"], extra: Partial<VizSpec> = {}): VizSpec => viz("stat", null, [y], unit, { reduce: "last", decimals: 0, ...extra });

interface TemplatePanel {
  title: string;
  sql: string;
  viz: VizSpec;
  /** Trends only: a primary trend takes the full width. */
  importance?: Importance;
}

interface TemplateSection {
  /** The section's heading; null for the panels at the top. */
  heading: { title: string; description: string } | null;
  panels: TemplatePanel[];
}

const panel = (title: string, sql: string, spec: VizSpec, importance?: Importance): TemplatePanel => ({ title, sql, viz: spec, importance });

type Ref = { heading: { title: string; description: string } } | { chart: TemplatePanel };

/** The template's panels, placed by the layout engine. */
function build(sections: TemplateSection[]): PanelInput[] {
  const arranged = arrange<Ref>(sections.map((section): ArrangeSection<Ref> => ({
    heading: section.heading ? { heading: section.heading } : null,
    items: section.panels.map((p) => ({ ref: { chart: p }, kind: "chart", role: roleOf(p.viz.type), importance: p.importance ?? "secondary", size: null })),
  })));
  return arranged.map(({ ref, layout }): PanelInput => ("heading" in ref
    ? { id: null, kind: "heading", title: ref.heading.title, description: ref.heading.description, layout }
    : { id: null, kind: "chart", title: ref.chart.title, sql: ref.chart.sql, viz: ref.chart.viz, fleet: false, layout }));
}

function template(fields: Omit<DashboardTemplate, "dashboard"> & { dashboard: Omit<DashboardInput, "connectionScope" | "panels" | "annotations"> & { sections: TemplateSection[] } }): DashboardTemplate {
  const { sections, ...settings } = fields.dashboard;
  return { ...fields, dashboard: { ...settings, annotations: [...DEFAULT_ANNOTATION_SOURCES], panels: build(sections) } };
}

export const TEMPLATES: DashboardTemplate[] = [
  template({
    id: "clickhouse-overview",
    title: "ClickHouse overview",
    description: "Query volume, failures, latency and memory at a glance.",
    openFrom: null,
    dashboard: {
      title: "ClickHouse overview",
      description: "Query volume, failures, latency and memory. CHouse's own queries are left out.",
      timeRange: "6h",
      refreshSeconds: 60,
      variables: [],
      sections: [
        {
          heading: null,
          panels: [
            panel("Running queries", "SELECT count() AS running FROM system.processes", stat("running", "count")),
            panel("Failed queries", `SELECT countIf(${FAILED}) AS failed FROM system.query_log WHERE ${IN_RANGE} AND ${NOT_OBSERVE}`,
              stat("failed", "count", { thresholds: [{ value: 1, severity: "warning" }] })),
            panel("Merges running", "SELECT count() AS merges FROM system.merges", stat("merges", "count")),
            panel("Max replica delay", "SELECT max(absolute_delay) AS delay FROM system.replicas",
              stat("delay", "s", { thresholds: [{ value: 60, severity: "warning" }, { value: 300, severity: "critical" }] })),
          ],
        },
        {
          heading: { title: "Queries", description: "What runs, how fast, and what fails" },
          panels: [
            panel("Queries", `SELECT ${BUCKET} AS t, countIf(type = 'QueryFinish') AS finished, countIf(${FAILED}) AS failed
FROM system.query_log WHERE ${IN_RANGE} AND ${NOT_OBSERVE} GROUP BY t ORDER BY t`, viz("stacked_area", "t", ["finished", "failed"], "count"), "primary"),
            panel("Query latency", `SELECT ${BUCKET} AS t, quantile(0.5)(query_duration_ms) AS p50, quantile(0.95)(query_duration_ms) AS p95, quantile(0.99)(query_duration_ms) AS p99
FROM system.query_log WHERE type = 'QueryFinish' AND ${IN_RANGE} AND ${NOT_OBSERVE} GROUP BY t ORDER BY t`, viz("line", "t", ["p50", "p95", "p99"], "ms")),
            panel("Memory tracked", `SELECT ${BUCKET} AS t, max(CurrentMetric_MemoryTracking) AS memory
FROM system.metric_log WHERE ${IN_RANGE} GROUP BY t ORDER BY t`, viz("area", "t", ["memory"], "bytes")),
            panel("Recent errors", `SELECT name, code, value AS occurrences, last_error_time, last_error_message
FROM system.errors WHERE value > 0 ORDER BY last_error_time DESC LIMIT 20`, viz("table", null, [], "none")),
          ],
        },
      ],
    },
  }),
  template({
    id: "merges-and-parts",
    title: "Merges and parts",
    description: "Parts per table and partition against the insert limits, and how merges keep up.",
    openFrom: null,
    dashboard: {
      title: "Merges and parts",
      description: "Active parts against parts_to_delay_insert (1000) and parts_to_throw_insert (3000), and merge throughput.",
      timeRange: "6h",
      refreshSeconds: 60,
      variables: [],
      sections: [
        {
          heading: null,
          panels: [
            panel("Most parts in one partition", `SELECT max(parts) AS parts FROM (
  SELECT database, table, partition_id, count() AS parts FROM system.parts WHERE active GROUP BY database, table, partition_id
)`, stat("parts", "count", { thresholds: [{ value: 1000, severity: "warning" }, { value: 3000, severity: "critical" }] })),
            panel("Active parts", "SELECT count() AS parts FROM system.parts WHERE active", stat("parts", "count")),
            panel("Merges running", "SELECT count() AS merges FROM system.merges", stat("merges", "count")),
          ],
        },
        {
          heading: { title: "Parts and merges", description: "Whether merges keep up with new parts" },
          panels: [
            panel("Parts created and merged", `SELECT ${BUCKET} AS t, countIf(event_type = 'NewPart') AS created, countIf(event_type = 'MergeParts') AS merged
FROM system.part_log WHERE ${IN_RANGE} GROUP BY t ORDER BY t`, viz("line", "t", ["created", "merged"], "count"), "primary"),
            panel("Active parts by table", `SELECT concat(database, '.', table) AS table_name, count() AS parts
FROM system.parts WHERE active GROUP BY table_name ORDER BY parts DESC LIMIT 15`, viz("horizontal_bar", "table_name", ["parts"], "count")),
            panel("Merge duration", `SELECT ${BUCKET} AS t, quantile(0.5)(duration_ms) AS p50, quantile(0.95)(duration_ms) AS p95
FROM system.part_log WHERE event_type = 'MergeParts' AND ${IN_RANGE} GROUP BY t ORDER BY t`, viz("line", "t", ["p50", "p95"], "ms")),
            panel("Running merges", `SELECT database, table, round(elapsed) AS elapsed_s, round(progress * 100, 1) AS progress_pct, num_parts,
  formatReadableSize(total_size_bytes_compressed) AS size
FROM system.merges ORDER BY elapsed DESC LIMIT 50`, viz("table", null, [], "none")),
          ],
        },
      ],
    },
  }),
  template({
    id: "replication",
    title: "Replication",
    description: "Replica delay, replication queues and fetches.",
    openFrom: null,
    dashboard: {
      title: "Replication",
      description: "How far replicas are behind and what their queues hold.",
      timeRange: "6h",
      refreshSeconds: 60,
      variables: [],
      sections: [
        {
          heading: null,
          panels: [
            panel("Max replica delay", "SELECT max(absolute_delay) AS delay FROM system.replicas",
              stat("delay", "s", { thresholds: [{ value: 60, severity: "warning" }, { value: 300, severity: "critical" }] })),
            panel("Replication queue", "SELECT sum(queue_size) AS tasks FROM system.replicas", stat("tasks", "count")),
            panel("Read-only replicas", "SELECT countIf(is_readonly) AS replicas FROM system.replicas",
              stat("replicas", "count", { thresholds: [{ value: 1, severity: "critical" }] })),
          ],
        },
        {
          heading: { title: "Queues and fetches", description: "What replicas still have to do" },
          panels: [
            panel("Parts fetched", `SELECT ${BUCKET} AS t, countIf(event_type = 'DownloadPart') AS fetched
FROM system.part_log WHERE ${IN_RANGE} GROUP BY t ORDER BY t`, viz("line", "t", ["fetched"], "count"), "primary"),
            panel("Queue by task type", `SELECT type, count() AS tasks FROM system.replication_queue GROUP BY type ORDER BY tasks DESC`,
              viz("bar", "type", ["tasks"], "count")),
            panel("Replicas", `SELECT database, table, absolute_delay, queue_size, inserts_in_queue, merges_in_queue, is_readonly, is_session_expired
FROM system.replicas ORDER BY absolute_delay DESC LIMIT 50`, viz("table", null, [], "none")),
          ],
        },
      ],
    },
  }),
  template({
    id: "query-latency",
    title: "Query latency",
    description: "Latency quantiles, the slowest users and query shapes, and failures.",
    openFrom: "performance",
    dashboard: {
      title: "Query latency",
      description: "Latency and failures from system.query_log. CHouse's own queries are left out.",
      timeRange: "6h",
      refreshSeconds: 60,
      variables: [],
      sections: [
        {
          heading: null,
          panels: [
            panel("Latency", `SELECT ${BUCKET} AS t, quantile(0.5)(query_duration_ms) AS p50, quantile(0.95)(query_duration_ms) AS p95, quantile(0.99)(query_duration_ms) AS p99
FROM system.query_log WHERE type = 'QueryFinish' AND ${IN_RANGE} AND ${NOT_OBSERVE} GROUP BY t ORDER BY t`, viz("line", "t", ["p50", "p95", "p99"], "ms"), "primary"),
            panel("Failures by error code", `SELECT toString(exception_code) AS code, count() AS failures
FROM system.query_log WHERE ${FAILED} AND ${IN_RANGE} AND ${NOT_OBSERVE} GROUP BY code ORDER BY failures DESC LIMIT 10`,
              viz("horizontal_bar", "code", ["failures"], "count")),
            panel("Queries per second", `SELECT ${BUCKET} AS t, count() / {{interval_s}} AS qps
FROM system.query_log WHERE type = 'QueryFinish' AND ${IN_RANGE} AND ${NOT_OBSERVE} GROUP BY t ORDER BY t`, viz("area", "t", ["qps"], "per_s", { decimals: 2 })),
            panel("p95 latency by user", `SELECT ${BUCKET} AS t, user, quantile(0.95)(query_duration_ms) AS p95
FROM system.query_log
WHERE type = 'QueryFinish' AND ${IN_RANGE} AND ${NOT_OBSERVE}
  AND user IN (SELECT user FROM system.query_log WHERE type = 'QueryFinish' AND ${IN_RANGE} AND ${NOT_OBSERVE} GROUP BY user ORDER BY count() DESC LIMIT 8)
GROUP BY t, user ORDER BY t`, viz("line", "t", ["p95"], "ms", { series: "user" })),
            panel("Slowest query shapes", `SELECT toString(normalized_query_hash) AS shape, any(substring(query, 1, 200)) AS sample, count() AS runs,
  round(quantile(0.95)(query_duration_ms)) AS p95_ms, formatReadableSize(sum(read_bytes)) AS read
FROM system.query_log WHERE type = 'QueryFinish' AND ${IN_RANGE} AND ${NOT_OBSERVE}
GROUP BY normalized_query_hash ORDER BY p95_ms DESC LIMIT 20`, viz("table", null, [], "none")),
          ],
        },
      ],
    },
  }),
  template({
    id: "disk-and-tables",
    title: "Disk and tables",
    description: "Free space per disk, the largest tables and databases, and what is being written.",
    openFrom: "capacity",
    dashboard: {
      title: "Disk and tables",
      description: "Where the bytes are, and how fast new ones arrive.",
      timeRange: "24h",
      refreshSeconds: 300,
      variables: [],
      sections: [
        {
          heading: null,
          panels: [
            panel("Bytes written", `SELECT ${BUCKET} AS t, sum(size_in_bytes) AS written
FROM system.part_log WHERE event_type = 'NewPart' AND ${IN_RANGE} GROUP BY t ORDER BY t`, viz("area", "t", ["written"], "bytes"), "primary"),
            panel("Disk space", "SELECT name AS disk, total_space - free_space AS used, free_space AS free FROM system.disks ORDER BY disk",
              viz("stacked_bar", "disk", ["used", "free"], "bytes")),
            panel("Size by database", `SELECT database, sum(bytes_on_disk) AS bytes FROM system.parts WHERE active
GROUP BY database ORDER BY bytes DESC LIMIT 12`, viz("donut", "database", ["bytes"], "bytes")),
            panel("Largest tables", `SELECT concat(database, '.', table) AS table_name, sum(bytes_on_disk) AS bytes
FROM system.parts WHERE active GROUP BY table_name ORDER BY bytes DESC LIMIT 15`, viz("horizontal_bar", "table_name", ["bytes"], "bytes")),
            panel("Tables", `SELECT database, table, sum(rows) AS rows, formatReadableSize(sum(data_compressed_bytes)) AS compressed,
  formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed,
  round(sum(data_uncompressed_bytes) / greatest(sum(data_compressed_bytes), 1), 2) AS ratio
FROM system.parts WHERE active GROUP BY database, table ORDER BY sum(bytes_on_disk) DESC LIMIT 50`, viz("table", null, [], "none")),
          ],
        },
      ],
    },
  }),
  template({
    id: "ingestion",
    title: "Kafka and S3Queue ingestion",
    description: "Rows arriving per table, Kafka consumers and S3Queue files.",
    openFrom: null,
    dashboard: {
      title: "Kafka and S3Queue ingestion",
      description: "Rows written per table from system.part_log, Kafka consumers and S3Queue file status.",
      timeRange: "6h",
      refreshSeconds: 60,
      variables: [],
      sections: [
        {
          heading: null,
          panels: [
            panel("Rows inserted per second", `SELECT ${BUCKET} AS t, sum(rows) / {{interval_s}} AS rows_per_s
FROM system.part_log WHERE event_type = 'NewPart' AND ${IN_RANGE} GROUP BY t ORDER BY t`, viz("area", "t", ["rows_per_s"], "per_s", { decimals: 0 }), "primary"),
            panel("S3Queue files by status", `SELECT status, count() AS files FROM system.s3queue_metadata_cache GROUP BY status ORDER BY files DESC`,
              viz("bar", "status", ["files"], "count")),
            panel("Rows inserted by table", `SELECT ${BUCKET} AS t, concat(database, '.', table) AS table_name, sum(rows) AS inserted
FROM system.part_log
WHERE event_type = 'NewPart' AND ${IN_RANGE}
  AND concat(database, '.', table) IN (SELECT concat(database, '.', table) FROM system.part_log WHERE event_type = 'NewPart' AND ${IN_RANGE} GROUP BY database, table ORDER BY sum(rows) DESC LIMIT 8)
GROUP BY t, table_name ORDER BY t`, viz("line", "t", ["inserted"], "rows", { series: "table_name" })),
            panel("Kafka consumers", `SELECT database, table, consumer_id, num_messages_read, num_commits, last_poll_time, last_commit_time, is_currently_used,
  length(exceptions.text) AS exceptions
FROM system.kafka_consumers ORDER BY database, table, consumer_id`, viz("table", null, [], "none")),
          ],
        },
      ],
    },
  }),
];

export function findTemplate(id: string): DashboardTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
