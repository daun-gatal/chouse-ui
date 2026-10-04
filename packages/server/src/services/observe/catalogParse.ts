/**
 * Pure helpers that turn `system.tables` / `system.dictionaries` metadata into
 * structural lineage (ADR 0016 §3). Engine-neutral: queue engines, object
 * storage queues, external engines, Distributed, Buffer, dictionaries and both
 * kinds of materialized views map onto the same node/edge vocabulary.
 */

export type ObjectKind =
  | "table"
  | "view"
  | "materialized_view"
  | "refreshable_view"
  | "dictionary"
  | "distributed"
  | "buffer"
  | "queue_engine"
  | "object_storage_queue"
  | "external_table"
  | "replicated_database_table";

export const QUEUE_ENGINES = new Set(["Kafka", "RabbitMQ", "NATS", "FileLog", "Redis"]);
export const OBJECT_STORAGE_QUEUE_ENGINES = new Set(["S3Queue", "AzureQueue"]);
export const EXTERNAL_ENGINES = new Set(["PostgreSQL", "MySQL", "MongoDB", "S3", "URL", "HDFS", "AzureBlobStorage", "SQLite", "ODBC", "JDBC", "Iceberg", "DeltaLake", "Hudi", "Redis", "File"]);
export function tableNodeId(database: string, table: string): string {
  return `table:${database}.${table}`;
}

export function externalNodeId(kind: string, ref: string): string {
  return `external:${kind}:${ref}`;
}

export function classifyObject(engine: string, createQuery: string, databaseEngine: string | null): ObjectKind {
  if (engine === "MaterializedView") return /\bREFRESH\s+(EVERY|AFTER)\b/i.test(createQuery) ? "refreshable_view" : "materialized_view";
  if (engine === "View") return "view";
  if (engine === "Dictionary") return "dictionary";
  if (engine === "Distributed") return "distributed";
  if (engine === "Buffer") return "buffer";
  if (OBJECT_STORAGE_QUEUE_ENGINES.has(engine)) return "object_storage_queue";
  if (QUEUE_ENGINES.has(engine) && engine !== "Redis") return "queue_engine";
  if (EXTERNAL_ENGINES.has(engine)) return "external_table";
  if (databaseEngine && (databaseEngine === "MaterializedPostgreSQL" || databaseEngine === "MaterializedMySQL")) return "replicated_database_table";
  return "table";
}

const IDENT = String.raw`(?:\x60[^\x60]+\x60|[A-Za-z_][A-Za-z0-9_]*)`;

function clean(identifier: string): string {
  return identifier.replace(/\x60/g, "");
}

function qualify(ref: string, defaultDb: string): { database: string; table: string } {
  const parts = ref.split(".").map((p) => clean(p.trim()));
  return parts.length >= 2 ? { database: parts[0], table: parts[1] } : { database: defaultDb, table: parts[0] };
}

/** `CREATE MATERIALIZED VIEW db.mv [REFRESH …] TO db.target … AS SELECT` → target. */
export function parseMvTarget(createQuery: string, database: string): { database: string; table: string } | null {
  const head = createQuery.split(/\bAS\s+(?:WITH|SELECT|\()/i)[0] ?? createQuery;
  const match = new RegExp(String.raw`\bTO\s+(${IDENT}(?:\s*\.\s*${IDENT})?)`, "i").exec(head);
  return match ? qualify(match[1].replace(/\s+/g, ""), database) : null;
}

export interface SelectSources {
  tables: Array<{ database: string; table: string }>;
  tableFunctions: Array<{ name: string; ref: string }>;
}

/** Tables and table functions after FROM / JOIN in the view's SELECT. */
export function parseSelectSources(createQuery: string, database: string): SelectSources {
  const select = createQuery.split(/\bAS\s+(?=WITH|SELECT|\()/i).slice(1).join(" AS ");
  const tables: SelectSources["tables"] = [];
  const tableFunctions: SelectSources["tableFunctions"] = [];
  const re = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(${IDENT}(?:\s*\.\s*${IDENT})?)(\s*\()?`, "gi");
  for (const match of select.matchAll(re)) {
    const ref = match[1].replace(/\s+/g, "");
    if (match[2]) {
      const after = select.slice((match.index ?? 0) + match[0].length);
      const firstArg = /^\s*'([^']*)'/.exec(after)?.[1] ?? "";
      tableFunctions.push({ name: clean(ref).toLowerCase(), ref: summarizeLocation(firstArg) });
      continue;
    }
    if (/^(SELECT|WITH)$/i.test(ref)) continue;
    const q = qualify(ref, database);
    if (q.database.toLowerCase() === "system") continue;
    if (!tables.some((t) => t.database === q.database && t.table === q.table)) tables.push(q);
  }
  return { tables, tableFunctions };
}

/** Strip credentials and query strings from a URL / path for display. */
export function summarizeLocation(location: string): string {
  return location.replace(/\/\/[^/@]+@/, "//").replace(/\?.*$/, "").slice(0, 160);
}

function settingValue(engineFull: string, name: string): string | null {
  const match = new RegExp(String.raw`\b${name}\s*=\s*'([^']*)'`, "i").exec(engineFull);
  return match ? match[1] : null;
}

function engineArgs(engineFull: string): string[] {
  const open = engineFull.indexOf("(");
  if (open < 0) return [];
  let depth = 0;
  let quote = false;
  let current = "";
  const args: string[] = [];
  for (let i = open + 1; i < engineFull.length; i++) {
    const ch = engineFull[i];
    if (ch === "'" && engineFull[i - 1] !== "\\") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") {
      if (depth === 0) break;
      depth--;
    }
    if (!quote && depth === 0 && ch === ",") {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args.map((a) => a.replace(/^'(.*)'$/s, "$1"));
}

/**
 * The upstream system an engine table reads from, for every engine kind:
 * Kafka topic, RabbitMQ exchange, NATS subject, S3/Azure path, Postgres table…
 */
export function parseEngineSource(engine: string, engineFull: string): { kind: string; ref: string } | null {
  const args = engineArgs(engineFull);
  switch (engine) {
    case "Kafka":
      return { kind: "kafka", ref: settingValue(engineFull, "kafka_topic_list") ?? args[1] ?? "topic" };
    case "RabbitMQ":
      return { kind: "rabbitmq", ref: settingValue(engineFull, "rabbitmq_exchange_name") ?? settingValue(engineFull, "rabbitmq_queue_base") ?? "exchange" };
    case "NATS":
      return { kind: "nats", ref: settingValue(engineFull, "nats_subjects") ?? "subjects" };
    case "FileLog":
      return { kind: "filelog", ref: summarizeLocation(args[0] ?? "path") };
    case "S3Queue":
    case "S3":
      return { kind: "s3", ref: summarizeLocation(args[0] ?? settingValue(engineFull, "url") ?? "bucket") };
    case "AzureQueue":
    case "AzureBlobStorage":
      return { kind: "azure", ref: summarizeLocation(args[1] ?? args[0] ?? "container") };
    case "URL":
      return { kind: "url", ref: summarizeLocation(args[0] ?? "url") };
    case "HDFS":
      return { kind: "hdfs", ref: summarizeLocation(args[0] ?? "path") };
    case "PostgreSQL":
    case "MySQL":
    case "MongoDB":
      // host:port, database, table — never the user / password arguments.
      return { kind: engine.toLowerCase(), ref: [args[0], args[1], args[2]].filter(Boolean).join("/") || engine };
    case "SQLite":
    case "File":
      return { kind: engine.toLowerCase(), ref: summarizeLocation(args[0] ?? engine) };
    case "Iceberg":
    case "DeltaLake":
    case "Hudi":
      return { kind: engine.toLowerCase(), ref: summarizeLocation(args[0] ?? engine) };
    case "ODBC":
    case "JDBC":
      return { kind: engine.toLowerCase(), ref: [args[1], args[2]].filter(Boolean).join("/") || engine };
    default:
      return null;
  }
}

/** Distributed(cluster, db, table[, sharding_key]) → local table. */
export function parseDistributed(engineFull: string, defaultDb: string): { cluster: string; database: string; table: string } | null {
  const args = engineArgs(engineFull);
  if (args.length < 3) return null;
  const database = args[1] === "currentDatabase()" ? defaultDb : clean(args[1]);
  return { cluster: clean(args[0]), database, table: clean(args[2]) };
}

/** Buffer(db, table, …) → destination table. */
export function parseBuffer(engineFull: string, defaultDb: string): { database: string; table: string } | null {
  const args = engineArgs(engineFull);
  if (args.length < 2) return null;
  return { database: args[0] === "currentDatabase()" || args[0] === "" ? defaultDb : clean(args[0]), table: clean(args[1]) };
}

/** system.dictionaries.source, e.g. "ClickHouse: db.table" or "PostgreSQL: host/db.table". */
export function parseDictionarySource(source: string, defaultDb: string): { kind: "table"; database: string; table: string } | { kind: string; ref: string } | null {
  const match = /^\s*([A-Za-z]+)\s*:\s*(.+)$/.exec(source);
  if (!match) return null;
  const engine = match[1].toLowerCase();
  const ref = match[2].trim();
  if (engine === "clickhouse") {
    const tableRef = ref.split(/\s+/)[0];
    const q = qualify(tableRef, defaultDb);
    return { kind: "table", database: q.database, table: q.table };
  }
  return { kind: engine, ref: summarizeLocation(ref) };
}

/**
 * A dictionary's source from its DDL, for dictionaries not loaded yet
 * (system.dictionaries.source stays empty until the first load).
 */
export function parseDictionaryCreate(createQuery: string, defaultDb: string): ReturnType<typeof parseDictionarySource> {
  const match = /\bSOURCE\s*\(\s*([A-Za-z]+)\s*\(([\s\S]*?)\)\s*\)/i.exec(createQuery);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const args = match[2];
  const arg = (name: string): string | null => new RegExp(String.raw`\b${name}\s+'([^']*)'`, "i").exec(args)?.[1] ?? null;
  if (kind === "clickhouse") {
    const table = arg("TABLE");
    if (!table) return null;
    return { kind: "table", database: arg("DB") || defaultDb, table };
  }
  const ref = [arg("HOST"), arg("DB"), arg("TABLE")].filter(Boolean).join("/") || summarizeLocation(arg("URL") ?? arg("PATH") ?? kind);
  return { kind, ref };
}
