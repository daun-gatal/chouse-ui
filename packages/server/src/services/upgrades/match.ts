/**
 * Turning what an upgrade changes into what it changes for this workload
 * (ADR 0029 §4). Pure: the snapshot diff, the release notes and the workload
 * facts in, findings out. A change becomes a finding only when the workload
 * uses it; every finding names its sources.
 */

import { escapeIdentifier, quoteStringLiteral } from "../../utils/sqlIdentifier";
import type { ReleaseNote } from "./notes";
import type { SnapshotDiff, VersionSnapshot } from "./snapshot";
import { typeFamilies, type Use, type WorkloadFacts } from "./workload";

export type Severity = "blocker" | "warning" | "info" | "note";

export interface EvidenceRow {
  cells: string[];
  /** `db.table` when the row names a table, so readers without access can be shown a count instead. */
  table?: string;
}

export interface FindingEvidence {
  source: {
    diff?: string;
    notes?: Array<{ id: string; line: string; prs: number[] }>;
    check?: string;
    ai?: { model: string };
  };
  head: string[];
  rows: EvidenceRow[];
  totalRows: number;
  noteText?: string;
  fix?: { title: string; sql?: string };
  keep?: { title: string; sql: string };
}

export interface FindingDraft {
  key: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: FindingEvidence;
}

const MAX_ROWS = 50;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 3): string => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`);

function rows(all: EvidenceRow[]): Pick<FindingEvidence, "rows" | "totalRows"> {
  return { rows: all.slice(0, MAX_ROWS), totalRows: all.length };
}

function useRows(use: Use): string[] {
  return [list(use.users, 2) || "—", list(use.clients, 2) || "—", use.shapes.toLocaleString("en-US"), use.runs7d.toLocaleString("en-US")];
}

const USE_HEAD = ["Users", "Clients", "Query shapes", "Runs (7d)"];

/** How names compare: case- and space-insensitive, so a note's `LIVE VIEW` names the LiveView engine. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

/** Names the workload touches, as name keys, for matching release notes. */
export function workloadNames(facts: WorkloadFacts, current: VersionSnapshot): Set<string> {
  const out = new Set<string>();
  const add = (n: string): void => {
    if (n) out.add(nameKey(n));
  };
  for (const c of facts.columns) for (const t of typeFamilies(c.type, current.types)) add(t);
  for (const t of facts.tables) add(t.engine);
  for (const d of facts.databases) add(d.engine);
  for (const p of facts.profileSettings) add(p.setting);
  for (const kind of Object.values(facts.queries)) for (const name of Object.keys(kind)) add(name);
  return out;
}

/**
 * Names nearly every workload has. A note that names only these is general
 * reading, not a sign that this workload is affected.
 */
const COMMON = new Set([
  "string", "fixedstring", "int8", "int16", "int32", "int64", "int128", "int256", "uint8", "uint16", "uint32", "uint64", "uint128", "uint256",
  "float32", "float64", "bool", "date", "date32", "datetime", "datetime64", "nullable", "array", "tuple", "map", "lowcardinality", "uuid",
  "decimal", "decimal32", "decimal64", "decimal128", "decimal256", "enum8", "enum16", "mergetree", "replicatedmergetree", "atomic", "memory",
  "count", "sum", "avg", "min", "max", "if", "and", "or", "not", "equals", "less", "greater", "tostring", "now", "today", "in", "notin",
  "max_threads", "max_execution_time", "readonly", "log_comment", "max_result_rows", "result_overflow_mode", "max_memory_usage",
  "output_format_json_quote_64bit_integers", "wait_end_of_query", "send_progress_in_http_headers", "database", "session_timeout", "query_id",
]);

/** Pure: notes that name something this workload uses (beyond the common names), and how many name only common ones. */
export function relevantNotes(notes: ReleaseNote[], names: Set<string>): { relevant: Array<{ note: ReleaseNote; matched: string[] }>; general: number } {
  const relevant: Array<{ note: ReleaseNote; matched: string[] }> = [];
  let general = 0;
  for (const note of notes) {
    const hits = [...new Set(note.names.filter((n) => names.has(nameKey(n))))];
    const specific = hits.filter((n) => !COMMON.has(nameKey(n)));
    if (specific.length) relevant.push({ note, matched: specific });
    else if (hits.length) general++;
  }
  return { relevant, general };
}

function notesNaming(notes: ReleaseNote[], name: string): ReleaseNote[] {
  const key = nameKey(name);
  return notes.filter((n) => n.names.some((x) => nameKey(x) === key));
}

function withNotes(finding: FindingDraft, notes: ReleaseNote[], names: string[]): FindingDraft {
  const related = [...new Map(names.flatMap((n) => notesNaming(notes, n)).map((n) => [n.id, n])).values()];
  if (!related.length) return finding;
  return {
    ...finding,
    evidence: {
      ...finding.evidence,
      source: { ...finding.evidence.source, notes: related.map((n) => ({ id: n.id, line: n.line, prs: n.prs })) },
      noteText: related[0].text,
    },
  };
}

function objectJsonFix(columns: Array<{ database: string; table: string; column: string }>): string | undefined {
  const first = columns[0];
  if (!first) return undefined;
  const t = `${escapeIdentifier(first.database)}.${escapeIdentifier(first.table)}`;
  const n = `${escapeIdentifier(first.database)}.${escapeIdentifier(`${first.table}_json`)}`;
  return [
    `CREATE TABLE ${n} AS ${t};`,
    `ALTER TABLE ${n} MODIFY COLUMN ${escapeIdentifier(first.column)} JSON;`,
    `INSERT INTO ${n} SELECT * FROM ${t};`,
    `EXCHANGE TABLES ${t} AND ${n};`,
  ].join("\n");
}

function settingLiteral(value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value) ? value : quoteStringLiteral(value);
}

export interface MatchInput {
  diff: SnapshotDiff | null;
  current: VersionSnapshot;
  targetVersion: string;
  facts: WorkloadFacts;
  notes: ReleaseNote[];
}

/** Pure: findings from the diff (exact mode) plus the workload checks that need no diff. */
export function matchFindings(input: MatchInput): FindingDraft[] {
  const { diff, current, facts, notes, targetVersion } = input;
  const out: FindingDraft[] = [];
  const q = facts.queries;

  if (diff) {
    for (const type of diff.removed.types) {
      const cols = facts.columns.filter((c) => typeFamilies(c.type, current.types).includes(type));
      const use = q.types[type];
      if (!cols.length && !use) continue;
      const tables = [...new Set(cols.map((c) => `${c.database}.${c.table}`))];
      const evidenceRows: EvidenceRow[] = cols.map((c) => ({ table: `${c.database}.${c.table}`, cells: [`${c.database}.${c.table}`, c.column, c.type, formatBytes(facts.tableBytes[`${c.database}.${c.table}`] ?? 0)] }));
      const sql = type === "Object" ? objectJsonFix(cols) : undefined;
      out.push(withNotes({
        key: `removed-type:${type}`,
        category: "removed-type",
        severity: "blocker",
        title: tables.length
          ? `${plural(tables.length, "table")} use${tables.length === 1 ? "s" : ""} the ${type} type, which ${targetVersion} no longer has`
          : `${plural(use!.shapes, "query shape")} use${use!.shapes === 1 ? "s" : ""} the ${type} type, which ${targetVersion} no longer has`,
        detail: tables.length
          ? `On ${targetVersion} these tables don't load, so every query to them fails.`
          : "Those queries fail on the target.",
        evidence: {
          source: { diff: `${type} is missing from the target's data types` },
          head: tables.length ? ["Table", "Column", "Type", "Size"] : USE_HEAD,
          ...rows(tables.length ? evidenceRows : [{ cells: useRows(use!) }]),
          ...(sql ? { fix: { title: "Move the column to the JSON type before upgrading (shown for the first table)", sql } } : { fix: { title: "Change these columns to a supported type before upgrading" } }),
        },
      }, notes, [type]));
    }

    for (const fn of diff.removed.functions) {
      const use = q.functions[fn];
      if (!use) continue;
      out.push(withNotes({
        key: `removed-function:${fn}`,
        category: "removed-function",
        severity: "blocker",
        title: `${plural(use.shapes, "query shape")} call${use.shapes === 1 ? "s" : ""} ${fn}, which ${targetVersion} no longer has`,
        detail: `They fail with UNKNOWN_FUNCTION on the target. Top callers: ${list(use.users, 3) || "unknown"}; ${use.runs7d.toLocaleString("en-US")} runs in 7 days.`,
        evidence: { source: { diff: `${fn} is missing from the target's functions` }, head: USE_HEAD, ...rows([{ cells: useRows(use) }]), fix: { title: "Replace the function in these queries before upgrading; the release note below names the replacement" } },
      }, notes, [fn]));
    }

    for (const engine of diff.removed.engines) {
      const tables = facts.tables.filter((t) => t.engine === engine);
      if (!tables.length && !q.storages[engine]) continue;
      out.push(withNotes({
        key: `removed-engine:${engine}`,
        category: "removed-engine",
        severity: "blocker",
        title: tables.length ? `${plural(tables.length, "table")} use${tables.length === 1 ? "s" : ""} the ${engine} engine, which ${targetVersion} no longer has` : `Queries use the ${engine} engine, which ${targetVersion} no longer has`,
        detail: tables.length ? "These tables don't load on the target." : "Those queries fail on the target.",
        evidence: {
          source: { diff: `${engine} is missing from the target's table engines` },
          head: tables.length ? ["Table", "Size"] : USE_HEAD,
          ...rows(tables.length ? tables.map((t) => ({ table: `${t.database}.${t.table}`, cells: [`${t.database}.${t.table}`, formatBytes(facts.tableBytes[`${t.database}.${t.table}`] ?? 0)] })) : [{ cells: useRows(q.storages[engine]) }]),
          fix: { title: "Recreate these tables with a supported engine before upgrading" },
        },
      }, notes, [engine]));
    }

    for (const engine of diff.removed.dbEngines) {
      const dbs = facts.databases.filter((d) => d.engine === engine);
      if (!dbs.length) continue;
      out.push(withNotes({
        key: `removed-db-engine:${engine}`,
        category: "removed-db-engine",
        severity: "blocker",
        title: `${plural(dbs.length, "database")} use${dbs.length === 1 ? "s" : ""} the ${engine} database engine, which ${targetVersion} no longer has`,
        detail: "Convert or recreate these databases before upgrading.",
        evidence: { source: { diff: `${engine} is missing from the target's database engines` }, head: ["Database"], ...rows(dbs.map((d) => ({ table: `${d.database}.`, cells: [d.database] }))) },
      }, notes, [engine]));
    }

    for (const format of diff.removed.formats) {
      const use = q.formats[format];
      if (!use) continue;
      out.push(withNotes({
        key: `removed-format:${format}`,
        category: "removed-format",
        severity: "blocker",
        title: `${plural(use.shapes, "query shape")} use${use.shapes === 1 ? "s" : ""} the ${format} format, which ${targetVersion} no longer has`,
        detail: "Those queries fail on the target.",
        evidence: { source: { diff: `${format} is missing from the target's formats` }, head: USE_HEAD, ...rows([{ cells: useRows(use) }]) },
      }, notes, [format]));
    }

    const setBy = (name: string): string[] => facts.profileSettings.filter((p) => p.setting === name).map((p) => p.target);
    const obsoleteUsed = diff.newlyObsolete.filter((name) => setBy(name).length || q.settings[name]);
    for (const name of obsoleteUsed) {
      const profiles = setBy(name);
      const use = q.settings[name];
      out.push(withNotes({
        key: `obsolete-setting:${name}`,
        category: "obsolete-setting",
        severity: "info",
        title: `${name} is obsolete on ${targetVersion}, and ${profiles.length ? `profile${profiles.length === 1 ? "" : "s"} ${list(profiles)} still set${profiles.length === 1 ? "s" : ""} it` : `${plural(use!.shapes, "query shape")} still set${use!.shapes === 1 ? "s" : ""} it`}`,
        detail: "Obsolete settings are accepted and ignored. Remove it so nobody thinks it still does something. If a release note below says a value is rejected, treat it as a blocker.",
        evidence: {
          source: { diff: `${name} has is_obsolete = 1 on the target` },
          head: ["Set by", "Value"],
          ...rows([...facts.profileSettings.filter((p) => p.setting === name).map((p) => ({ cells: [`profile ${p.target}`, p.value] })), ...(use ? [{ cells: [`${plural(use.shapes, "query shape")} (${list(use.users, 2)})`, use.values.join(", ")] }] : [])]),
        },
      }, notes, [name]));
    }

    const defaultProfile = new Set(facts.profileSettings.filter((p) => p.target === "default").map((p) => p.setting));
    const changed = diff.changedSettings.filter((c) => !defaultProfile.has(c.name));
    if (changed.length) {
      const touched = (name: string): boolean => Boolean(q.settings[name] || setBy(name).length || notesNaming(notes, name).length);
      const ordered = [...changed].sort((a, b) => Number(touched(b.name)) - Number(touched(a.name)) || a.name.localeCompare(b.name));
      const named = changed.filter((c) => notesNaming(notes, c.name).length);
      out.push(withNotes({
        key: "default-changes",
        category: "default-change",
        severity: "warning",
        title: `${plural(changed.length, "setting default")} change${changed.length === 1 ? "s" : ""} between ${current.version.split(".").slice(0, 2).join(".")} and ${targetVersion}`,
        detail: `Queries that don't set these themselves get the new value. ${named.length ? `${plural(named.length, "of them is", "of them are")} called out in a release note: ${list(named.map((c) => c.name), 4)}.` : "None of them is called out in a release note."} Settings your workload sets or a note mentions are listed first.`,
        evidence: {
          source: { diff: "default values in system.settings on both servers" },
          head: ["Setting", "Now", "On target", "Your workload"],
          ...rows(ordered.map((c) => ({ cells: [c.name, c.from || "''", c.to || "''", q.settings[c.name] ? `set by ${plural(q.settings[c.name].shapes, "shape")}` : setBy(c.name).length ? `set in ${list(setBy(c.name), 2)}` : "—"] }))),
          keep: {
            title: `Keep today's defaults for everyone while you test (or set compatibility = '${current.version.split(".").slice(0, 2).join(".")}')`,
            sql: `ALTER SETTINGS PROFILE default SETTINGS\n  ${ordered.slice(0, 8).map((c) => `${c.name} = ${settingLiteral(c.from)}`).join(",\n  ")};`,
          },
        },
      }, notes, named.map((c) => c.name)));
    }

    const mt = diff.changedMergeTree.filter((c) => !facts.serverMergeTree.includes(c.name));
    if (mt.length) {
      out.push({
        key: "merge-tree-default-changes",
        category: "merge-tree-default-change",
        severity: "info",
        title: `${plural(mt.length, "MergeTree setting default")} change${mt.length === 1 ? "s" : ""}`,
        detail: "Tables that don't set these in their SETTINGS clause, and servers that don't set them in <merge_tree>, get the new value.",
        evidence: { source: { diff: "default values in system.merge_tree_settings on both servers" }, head: ["Setting", "Now", "On target"], ...rows(mt.map((c) => ({ cells: [c.name, c.from || "''", c.to || "''"] }))) },
      });
    }
  }

  const compat = facts.profileSettings.filter((p) => p.setting === "compatibility");
  if (compat.length) {
    out.push({
      key: "compatibility-pinned",
      category: "compatibility",
      severity: "info",
      title: `${compat.length === 1 ? `Profile ${compat[0].target} pins` : `${compat.length} profiles pin`} compatibility = '${compat[0].value}'`,
      detail: "Users of these profiles keep that version's defaults, so default changes won't reach them until the pin is raised.",
      evidence: { source: { check: "settings profiles" }, head: ["Profile", "Value"], ...rows(compat.map((p) => ({ cells: [p.target, p.value] }))) },
    });
  }
  return out;
}

/** Pure: release notes for a person to judge, minus those already attached to a finding. */
export function noteFindings(notes: ReleaseNote[], names: Set<string>, findings: FindingDraft[]): { findings: FindingDraft[]; general: number } {
  const used = new Set(findings.flatMap((f) => f.evidence.source.notes?.map((n) => n.id) ?? []));
  const { relevant, general } = relevantNotes(notes.filter((n) => !used.has(n.id)), names);
  return {
    general,
    findings: relevant.map(({ note, matched }) => ({
      key: `note:${note.id}`,
      category: "release-note",
      severity: "note",
      title: note.text.length > 240 ? `${note.text.slice(0, 237)}…` : note.text,
      detail: `Names what your workload uses: ${list(matched.map((m) => `\`${m}\``), 4)}.`,
      evidence: { source: { notes: [{ id: note.id, line: note.line, prs: note.prs }] }, head: [], rows: [], totalRows: 0, noteText: note.text },
    })),
  };
}
