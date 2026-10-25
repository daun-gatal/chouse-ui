/**
 * The system tables the collector reads (ADR 0016 §4). Kept free of imports
 * so the connection privilege check can use it without pulling in the
 * collector's database and client modules.
 */

export const OBSERVED_SYSTEM_TABLES = [
  "tables",
  "columns",
  "databases",
  "dictionaries",
  "parts",
  "part_log",
  "query_log",
  "query_views_log",
  "processes",
  "merges",
  "mutations",
  "replicas",
  "disks",
  "errors",
  "settings_profile_elements",
  "kafka_consumers",
  "s3queue",
  "s3queue_log",
  "azure_queue",
  "azure_queue_log",
  "view_refreshes",
  "distribution_queue",
  "asynchronous_insert_log",
  "asynchronous_inserts",
  "asynchronous_metrics",
  "data_skipping_indices",
] as const;
