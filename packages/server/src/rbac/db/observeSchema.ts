/**
 * ADR 0016 — evidence-store DDL for the Data Observability Platform.
 *
 * Statements are written once with `{BIGINT}` / `{REAL}` placeholders and
 * rendered per dialect, so SQLite and PostgreSQL can never drift apart. Every
 * statement is `IF NOT EXISTS`, which keeps migration 1.53.0 idempotent on
 * stepwise and skip-version upgrades. Timestamps are unix milliseconds unless
 * a column name says otherwise (`*_s` = seconds).
 */

export type Dialect = "sqlite" | "postgres";

const OBSERVE_TABLES: string[] = [
  // --- collector runtime ----------------------------------------------------
  `CREATE TABLE IF NOT EXISTS obs_leases (
    lease_key   TEXT PRIMARY KEY NOT NULL,
    holder      TEXT NOT NULL DEFAULT '',
    acquired_at {BIGINT} NOT NULL DEFAULT 0,
    expires_at  {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS obs_watermarks (
    connection_id TEXT NOT NULL,
    collector     TEXT NOT NULL,
    watermark     {BIGINT} NOT NULL DEFAULT 0,
    updated_at    {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, collector)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_collector_status (
    connection_id      TEXT NOT NULL,
    collector          TEXT NOT NULL,
    state              TEXT NOT NULL DEFAULT 'pending',
    last_run_at        {BIGINT},
    last_ok_at         {BIGINT},
    last_error         TEXT,
    missing_privileges TEXT,
    duration_ms        {BIGINT},
    PRIMARY KEY (connection_id, collector)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_capabilities (
    connection_id  TEXT PRIMARY KEY NOT NULL,
    server_version TEXT,
    system_tables  TEXT NOT NULL DEFAULT '[]',
    system_columns TEXT NOT NULL DEFAULT '{}',
    probed_at      {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS obs_settings (
    setting_key TEXT PRIMARY KEY NOT NULL,
    value       TEXT NOT NULL,
    updated_by  TEXT,
    updated_at  {BIGINT} NOT NULL DEFAULT 0
  )`,

  // --- catalog & lineage ----------------------------------------------------
  `CREATE TABLE IF NOT EXISTS obs_catalog_tables (
    connection_id   TEXT NOT NULL,
    database_name   TEXT NOT NULL,
    table_name      TEXT NOT NULL,
    engine          TEXT NOT NULL DEFAULT '',
    engine_full     TEXT,
    sorting_key     TEXT,
    partition_key   TEXT,
    primary_key     TEXT,
    sampling_key    TEXT,
    total_rows      {REAL},
    total_bytes     {REAL},
    create_query    TEXT,
    comment         TEXT,
    metadata_at     {BIGINT},
    updated_at      {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, database_name, table_name)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_catalog_columns (
    connection_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    column_name   TEXT NOT NULL,
    column_type   TEXT NOT NULL,
    position      {BIGINT} NOT NULL DEFAULT 0,
    comment       TEXT,
    PRIMARY KEY (connection_id, database_name, table_name, column_name)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_lineage_nodes (
    connection_id TEXT NOT NULL,
    node_id       TEXT NOT NULL,
    kind          TEXT NOT NULL,
    label         TEXT NOT NULL,
    database_name TEXT,
    table_name    TEXT,
    attrs         TEXT NOT NULL DEFAULT '{}',
    last_seen_at  {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_lineage_edges (
    connection_id TEXT NOT NULL,
    edge_id       TEXT NOT NULL,
    source_id     TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    kind          TEXT NOT NULL,
    origin        TEXT NOT NULL,
    granularity   TEXT NOT NULL DEFAULT 'column',
    columns       TEXT NOT NULL DEFAULT '[]',
    observations  {BIGINT} NOT NULL DEFAULT 0,
    first_seen_at {BIGINT} NOT NULL DEFAULT 0,
    last_seen_at  {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, edge_id)
  )`,
  `CREATE INDEX IF NOT EXISTS obs_lineage_edges_source_idx ON obs_lineage_edges (connection_id, source_id)`,
  `CREATE INDEX IF NOT EXISTS obs_lineage_edges_target_idx ON obs_lineage_edges (connection_id, target_id)`,
  `CREATE TABLE IF NOT EXISTS obs_lineage_column_edges (
    connection_id TEXT NOT NULL,
    source_node   TEXT NOT NULL,
    source_column TEXT NOT NULL,
    target_node   TEXT NOT NULL,
    target_column TEXT NOT NULL,
    expression    TEXT,
    last_seen_at  {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, source_node, source_column, target_node, target_column)
  )`,

  // --- pipelines ------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS obs_pipelines (
    connection_id  TEXT NOT NULL,
    pipeline_id    TEXT NOT NULL,
    kind           TEXT NOT NULL,
    engine         TEXT NOT NULL DEFAULT '',
    name           TEXT NOT NULL,
    source_label   TEXT,
    source_node    TEXT,
    target_node    TEXT,
    status         TEXT NOT NULL DEFAULT 'healthy',
    status_reason  TEXT,
    status_since   {BIGINT} NOT NULL DEFAULT 0,
    last_sample_at {BIGINT},
    unsupported    TEXT,
    attrs          TEXT NOT NULL DEFAULT '{}',
    updated_at     {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, pipeline_id)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_pipeline_samples (
    connection_id   TEXT NOT NULL,
    pipeline_id     TEXT NOT NULL,
    granularity     TEXT NOT NULL,
    sampled_at      {BIGINT} NOT NULL,
    units_in        {REAL},
    bytes_in        {REAL},
    last_success_at {BIGINT},
    lag_seconds     {REAL},
    backlog         {REAL},
    backlog_unit    TEXT,
    errors          {REAL},
    error_sample    TEXT,
    error_class     TEXT,
    progressing     {BIGINT},
    PRIMARY KEY (connection_id, pipeline_id, granularity, sampled_at)
  )`,

  // --- tables, profiles, usage ----------------------------------------------
  `CREATE TABLE IF NOT EXISTS obs_table_baselines (
    connection_id      TEXT NOT NULL,
    database_name      TEXT NOT NULL,
    table_name         TEXT NOT NULL,
    state              TEXT NOT NULL DEFAULT 'learning',
    state_reason       TEXT,
    cadence_p50_s      {REAL},
    cadence_p99_s      {REAL},
    last_write_at      {BIGINT},
    volume_band        TEXT NOT NULL DEFAULT '{}',
    criticality        TEXT NOT NULL DEFAULT 'standard',
    criticality_pinned {BIGINT} NOT NULL DEFAULT 0,
    readers_7d         {BIGINT} NOT NULL DEFAULT 0,
    reads_7d           {BIGINT} NOT NULL DEFAULT 0,
    total_rows         {REAL},
    total_bytes        {REAL},
    updated_at         {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, database_name, table_name)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_table_samples (
    connection_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    granularity   TEXT NOT NULL,
    sampled_at    {BIGINT} NOT NULL,
    rows_added    {REAL},
    bytes_added   {REAL},
    parts_added   {BIGINT},
    total_rows    {REAL},
    total_bytes   {REAL},
    PRIMARY KEY (connection_id, database_name, table_name, granularity, sampled_at)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_column_profiles (
    connection_id  TEXT NOT NULL,
    database_name  TEXT NOT NULL,
    table_name     TEXT NOT NULL,
    column_name    TEXT NOT NULL,
    profiled_at    {BIGINT} NOT NULL,
    null_ratio     {REAL},
    distinct_count {REAL},
    p50            {REAL},
    p95            {REAL},
    top_values     TEXT NOT NULL DEFAULT '[]',
    sample_rows    {REAL},
    PRIMARY KEY (connection_id, database_name, table_name, column_name, profiled_at)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_usage_rollups (
    connection_id  TEXT NOT NULL,
    database_name  TEXT NOT NULL,
    table_name     TEXT NOT NULL,
    principal_kind TEXT NOT NULL,
    principal_id   TEXT NOT NULL,
    day            {BIGINT} NOT NULL,
    reads          {BIGINT} NOT NULL DEFAULT 0,
    read_bytes     {REAL} NOT NULL DEFAULT 0,
    filter_columns TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (connection_id, database_name, table_name, principal_kind, principal_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_suggestion_dismissals (
    connection_id  TEXT NOT NULL,
    suggestion_key TEXT NOT NULL,
    dismissed_by   TEXT,
    dismissed_at   {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, suggestion_key)
  )`,

  // --- performance ----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS obs_query_fingerprints (
    connection_id TEXT NOT NULL,
    fingerprint   TEXT NOT NULL,
    replica       TEXT NOT NULL,
    sample_query  TEXT,
    query_kind    TEXT,
    user_name     TEXT,
    tables        TEXT NOT NULL DEFAULT '[]',
    first_seen_at {BIGINT} NOT NULL DEFAULT 0,
    last_seen_at  {BIGINT} NOT NULL DEFAULT 0,
    total_ms      {REAL} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, fingerprint, replica)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_fingerprint_rollups (
    connection_id  TEXT NOT NULL,
    fingerprint    TEXT NOT NULL,
    replica        TEXT NOT NULL,
    hour           {BIGINT} NOT NULL,
    runs           {BIGINT} NOT NULL DEFAULT 0,
    errors         {BIGINT} NOT NULL DEFAULT 0,
    p50_ms         {REAL},
    p95_ms         {REAL},
    avg_read_bytes {REAL},
    avg_memory     {REAL},
    server_version TEXT,
    PRIMARY KEY (connection_id, fingerprint, replica, hour)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_regressions (
    id             TEXT PRIMARY KEY NOT NULL,
    connection_id  TEXT NOT NULL,
    fingerprint    TEXT NOT NULL,
    replica        TEXT NOT NULL,
    metric         TEXT NOT NULL,
    baseline_value {REAL} NOT NULL,
    current_value  {REAL} NOT NULL,
    ratio          {REAL} NOT NULL,
    runs           {BIGINT} NOT NULL DEFAULT 0,
    onset_at       {BIGINT} NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open',
    linked_changes TEXT NOT NULL DEFAULT '[]',
    sample_query   TEXT,
    detected_at    {BIGINT} NOT NULL,
    resolved_at    {BIGINT}
  )`,
  `CREATE INDEX IF NOT EXISTS obs_regressions_conn_idx ON obs_regressions (connection_id, status, detected_at)`,
  `CREATE TABLE IF NOT EXISTS obs_change_events (
    id            TEXT PRIMARY KEY NOT NULL,
    connection_id TEXT NOT NULL,
    kind          TEXT NOT NULL,
    occurred_at   {BIGINT} NOT NULL,
    node          TEXT,
    object_ref    TEXT,
    summary       TEXT NOT NULL,
    details       TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS obs_change_events_conn_idx ON obs_change_events (connection_id, occurred_at)`,

  // --- capacity & cost ------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS obs_capacity_samples (
    connection_id TEXT NOT NULL,
    node          TEXT NOT NULL,
    disk_name     TEXT NOT NULL,
    sampled_at    {BIGINT} NOT NULL,
    total_bytes   {REAL} NOT NULL,
    free_bytes    {REAL} NOT NULL,
    PRIMARY KEY (connection_id, node, disk_name, sampled_at)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_capacity_forecasts (
    connection_id        TEXT NOT NULL,
    node                 TEXT NOT NULL,
    disk_name            TEXT NOT NULL,
    computed_at          {BIGINT} NOT NULL,
    used_ratio           {REAL} NOT NULL,
    growth_bytes_per_day {REAL},
    days_to_threshold    {REAL},
    threshold            {REAL} NOT NULL,
    PRIMARY KEY (connection_id, node, disk_name)
  )`,
  `CREATE TABLE IF NOT EXISTS obs_codec_trials (
    id              TEXT PRIMARY KEY NOT NULL,
    connection_id   TEXT NOT NULL,
    database_name   TEXT NOT NULL,
    table_name      TEXT NOT NULL,
    column_name     TEXT NOT NULL,
    current_codec   TEXT,
    candidate_codec TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    ratio_before    {REAL},
    ratio_after     {REAL},
    saved_bytes     {REAL},
    error           TEXT,
    requested_by    TEXT,
    created_at      {BIGINT} NOT NULL,
    finished_at     {BIGINT}
  )`,
  `CREATE TABLE IF NOT EXISTS obs_cost_rates (
    id           {BIGINT} PRIMARY KEY NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'USD',
    per_tib_read {REAL} NOT NULL DEFAULT 0,
    per_cpu_hour {REAL} NOT NULL DEFAULT 0,
    updated_by   TEXT,
    updated_at   {BIGINT} NOT NULL DEFAULT 0
  )`,

  // --- incidents, RCA, blast radius -----------------------------------------
  `CREATE TABLE IF NOT EXISTS obs_incidents (
    id              TEXT PRIMARY KEY NOT NULL,
    connection_id   TEXT NOT NULL,
    kind            TEXT NOT NULL,
    subject_ref     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    severity        TEXT NOT NULL,
    summary         TEXT NOT NULL,
    opened_at       {BIGINT} NOT NULL,
    acknowledged_by TEXT,
    acknowledged_at {BIGINT},
    recovered_at    {BIGINT},
    last_event_at   {BIGINT} NOT NULL,
    created_at      {BIGINT} NOT NULL DEFAULT 0,
    updated_at      {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS obs_incidents_status_idx ON obs_incidents (connection_id, status, last_event_at)`,
  `CREATE INDEX IF NOT EXISTS obs_incidents_subject_idx ON obs_incidents (connection_id, kind, subject_ref)`,
  `CREATE TABLE IF NOT EXISTS incident_rca (
    incident_source TEXT NOT NULL,
    incident_id     TEXT NOT NULL,
    computed_at     {BIGINT} NOT NULL,
    signature       TEXT,
    chain           TEXT NOT NULL DEFAULT '[]',
    root_cause      TEXT,
    related         TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (incident_source, incident_id)
  )`,
  `CREATE INDEX IF NOT EXISTS incident_rca_signature_idx ON incident_rca (signature)`,
  `CREATE TABLE IF NOT EXISTS incident_blast_radius (
    incident_source TEXT NOT NULL,
    incident_id     TEXT NOT NULL,
    computed_at     {BIGINT} NOT NULL,
    items           TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (incident_source, incident_id)
  )`,

  // --- remediation ----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS remediation_credentials (
    connection_id      TEXT PRIMARY KEY NOT NULL,
    username           TEXT NOT NULL,
    password_encrypted TEXT,
    updated_by         TEXT,
    updated_at         {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS remediation_actions (
    id              TEXT PRIMARY KEY NOT NULL,
    connection_id   TEXT NOT NULL,
    action_type     TEXT NOT NULL,
    params          TEXT NOT NULL DEFAULT '{}',
    approval_class  {BIGINT} NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'proposed',
    title           TEXT NOT NULL,
    rationale       TEXT,
    proposed_by     TEXT,
    proposed_source TEXT NOT NULL DEFAULT 'user',
    incident_source TEXT,
    incident_id     TEXT,
    notebook_id     TEXT,
    preview_sql     TEXT NOT NULL,
    rollback_sql    TEXT,
    verification    TEXT NOT NULL DEFAULT '{}',
    window_only     {BIGINT} NOT NULL DEFAULT 0,
    created_at      {BIGINT} NOT NULL,
    updated_at      {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS remediation_actions_status_idx ON remediation_actions (status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS remediation_approvals (
    id          TEXT PRIMARY KEY NOT NULL,
    action_id   TEXT NOT NULL,
    approver_id TEXT NOT NULL,
    channel     TEXT NOT NULL,
    decision    TEXT NOT NULL,
    comment     TEXT,
    created_at  {BIGINT} NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS remediation_approvals_unique_idx ON remediation_approvals (action_id, approver_id)`,
  `CREATE TABLE IF NOT EXISTS remediation_executions (
    id                  TEXT PRIMARY KEY NOT NULL,
    action_id           TEXT NOT NULL,
    status              TEXT NOT NULL,
    executed_sql        TEXT,
    error               TEXT,
    verification_result TEXT,
    started_at          {BIGINT} NOT NULL,
    finished_at         {BIGINT},
    verified_at         {BIGINT},
    rolled_back_at      {BIGINT}
  )`,
  `CREATE INDEX IF NOT EXISTS remediation_executions_action_idx ON remediation_executions (action_id, started_at)`,

  // --- notebooks ------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS notebooks (
    id            TEXT PRIMARY KEY NOT NULL,
    title         TEXT NOT NULL,
    owner_id      TEXT,
    attached_kind TEXT NOT NULL DEFAULT 'none',
    attached_ref  TEXT,
    connection_id TEXT,
    created_at    {BIGINT} NOT NULL,
    updated_at    {BIGINT} NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notebooks_attached_idx ON notebooks (attached_kind, attached_ref)`,
  `CREATE TABLE IF NOT EXISTS notebook_cells (
    id          TEXT PRIMARY KEY NOT NULL,
    notebook_id TEXT NOT NULL,
    position    {BIGINT} NOT NULL,
    kind        TEXT NOT NULL,
    author_kind TEXT NOT NULL,
    author_id   TEXT,
    content     TEXT NOT NULL DEFAULT '{}',
    created_at  {BIGINT} NOT NULL,
    updated_at  {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS notebook_cells_notebook_idx ON notebook_cells (notebook_id, position)`,

  // --- context engine -------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS ctx_table_context (
    connection_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    description   TEXT,
    grain         TEXT,
    owner         TEXT,
    instead_of    TEXT,
    deprecated    {BIGINT} NOT NULL DEFAULT 0,
    tags          TEXT NOT NULL DEFAULT '[]',
    source        TEXT NOT NULL DEFAULT 'manual',
    verified_by   TEXT,
    verified_at   {BIGINT},
    updated_by    TEXT,
    updated_at    {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, database_name, table_name)
  )`,
  `CREATE TABLE IF NOT EXISTS ctx_metrics (
    id            TEXT PRIMARY KEY NOT NULL,
    connection_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    name          TEXT NOT NULL,
    expression    TEXT NOT NULL,
    description   TEXT,
    owner         TEXT,
    created_by    TEXT,
    updated_at    {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ctx_metrics_name_idx ON ctx_metrics (connection_id, database_name, table_name, name)`,
  `CREATE TABLE IF NOT EXISTS ctx_patterns (
    connection_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    fingerprint   TEXT NOT NULL,
    sample_query  TEXT NOT NULL,
    runs          {BIGINT} NOT NULL DEFAULT 0,
    users         {BIGINT} NOT NULL DEFAULT 0,
    p95_ms        {REAL},
    read_ratio    {REAL},
    updated_at    {BIGINT} NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, database_name, table_name, fingerprint)
  )`,

  // --- agents ---------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS agent_sessions (
    id           TEXT PRIMARY KEY NOT NULL,
    pat_id       TEXT,
    user_id      TEXT,
    client_name  TEXT,
    source       TEXT NOT NULL,
    started_at   {BIGINT} NOT NULL,
    last_seen_at {BIGINT} NOT NULL,
    queries      {BIGINT} NOT NULL DEFAULT 0,
    read_bytes   {REAL} NOT NULL DEFAULT 0,
    warnings     {BIGINT} NOT NULL DEFAULT 0,
    blocked      {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS agent_sessions_seen_idx ON agent_sessions (last_seen_at)`,
  `CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id           TEXT PRIMARY KEY NOT NULL,
    session_id   TEXT NOT NULL,
    pat_id       TEXT,
    user_id      TEXT,
    tool         TEXT NOT NULL,
    args_summary TEXT,
    outcome      TEXT NOT NULL,
    detail       TEXT NOT NULL DEFAULT '{}',
    read_bytes   {REAL} NOT NULL DEFAULT 0,
    created_at   {BIGINT} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agent_tool_calls_session_idx ON agent_tool_calls (session_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS agent_policies (
    id                     TEXT PRIMARY KEY NOT NULL,
    scope_kind             TEXT NOT NULL,
    scope_id               TEXT NOT NULL,
    max_bytes_per_query    {REAL},
    daily_bytes            {REAL},
    partition_filter_bytes {REAL},
    incident_mode          TEXT NOT NULL DEFAULT 'warn',
    alert_multiplier       {REAL},
    updated_by             TEXT,
    updated_at             {BIGINT} NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_policies_scope_idx ON agent_policies (scope_kind, scope_id)`,

  // --- upgrades -------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS upgrade_assessments (
    id             TEXT PRIMARY KEY NOT NULL,
    connection_id  TEXT NOT NULL,
    current_version TEXT,
    target_version TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'running',
    verdict        TEXT,
    summary        TEXT NOT NULL DEFAULT '{}',
    created_by     TEXT,
    created_at     {BIGINT} NOT NULL,
    finished_at    {BIGINT}
  )`,
  `CREATE TABLE IF NOT EXISTS upgrade_findings (
    id            TEXT PRIMARY KEY NOT NULL,
    assessment_id TEXT NOT NULL,
    category      TEXT NOT NULL,
    severity      TEXT NOT NULL,
    title         TEXT NOT NULL,
    detail        TEXT,
    evidence      TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS upgrade_findings_assessment_idx ON upgrade_findings (assessment_id)`,
  `CREATE TABLE IF NOT EXISTS replay_runs (
    id                   TEXT PRIMARY KEY NOT NULL,
    assessment_id        TEXT,
    connection_id        TEXT NOT NULL,
    canary_connection_id TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'running',
    total                {BIGINT} NOT NULL DEFAULT 0,
    same                 {BIGINT} NOT NULL DEFAULT 0,
    differs              {BIGINT} NOT NULL DEFAULT 0,
    slower               {BIGINT} NOT NULL DEFAULT 0,
    errors               {BIGINT} NOT NULL DEFAULT 0,
    requested_by         TEXT,
    started_at           {BIGINT} NOT NULL,
    finished_at          {BIGINT}
  )`,
  `CREATE TABLE IF NOT EXISTS replay_results (
    run_id        TEXT NOT NULL,
    fingerprint   TEXT NOT NULL,
    outcome       TEXT NOT NULL,
    baseline_ms   {REAL},
    canary_ms     {REAL},
    baseline_hash TEXT,
    canary_hash   TEXT,
    error         TEXT,
    PRIMARY KEY (run_id, fingerprint)
  )`,
];

/** Render the statements for one dialect. */
export function observeSchemaStatements(dialect: Dialect): string[] {
  const bigint = dialect === "sqlite" ? "INTEGER" : "BIGINT";
  const real = dialect === "sqlite" ? "REAL" : "DOUBLE PRECISION";
  return OBSERVE_TABLES.map((stmt) => stmt.replaceAll("{BIGINT}", bigint).replaceAll("{REAL}", real));
}

/** Table names created by 1.53.0, for migration checks. */
export const OBSERVE_TABLE_NAMES: string[] = OBSERVE_TABLES
  .map((stmt) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(stmt)?.[1])
  .filter((name): name is string => typeof name === "string");
