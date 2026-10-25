/**
 * ADR 0026 migrations (shared notify layer, chat apps, actions from chat).
 * Idempotent: tables and indexes are `IF NOT EXISTS`, column adds are guarded,
 * and the backfill only touches rows it has not filled in yet.
 */

import { sql, type SQL } from 'drizzle-orm';

import { logger } from '../../utils/logger';
import { getDatabaseType, type PostgresDb, type RbacDb, type SqliteDb } from './index';
import { ALERT_EVENT_COLUMNS, notifyIndexStatements, notifyTableStatements } from './notifySchema';
import type { Migration } from './migrations';

type Row = Record<string, unknown>;

async function rows(db: RbacDb, statement: SQL): Promise<Row[]> {
  if (getDatabaseType() === 'sqlite') return (db as SqliteDb).all(statement) as Row[];
  const result = (await (db as PostgresDb).execute(statement)) as unknown;
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] }).rows ?? [];
}

async function exec(db: RbacDb, statement: SQL): Promise<void> {
  if (getDatabaseType() === 'sqlite') (db as SqliteDb).run(statement);
  else await (db as PostgresDb).execute(statement);
}

async function hasColumn(db: RbacDb, table: string, column: string): Promise<boolean> {
  const found = getDatabaseType() === 'sqlite'
    ? await rows(db, sql`SELECT 1 FROM pragma_table_info(${table}) WHERE name = ${column}`)
    : await rows(db, sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}`);
  return found.length > 0;
}

function dialect(): 'sqlite' | 'postgres' {
  return getDatabaseType() === 'sqlite' ? 'sqlite' : 'postgres';
}

function parsePayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Where an event recorded before 1.74.0 came from. Only fleet rules, panel
 * alerts and dashboard reports wrote events then: fleet rows point at an
 * alert rule, the other two say so in their JSON payload.
 */
export function legacyEventSource(ruleSourceType: string | null, payload: Record<string, unknown> | null): string {
  if (ruleSourceType === 'fleet_threshold') return 'fleet_alert';
  if (ruleSourceType) return ruleSourceType;
  if (payload?.source === 'dashboard_panel_alert') return 'dashboard_alert';
  if (payload?.source === 'dashboard_report') return 'dashboard_report';
  return 'other';
}

const BACKFILL_BATCH = 500;

async function backfillEventSources(db: RbacDb): Promise<number> {
  let filled = 0;
  for (;;) {
    const batch = await rows(db, sql`
      SELECT e.id, e.payload, r.source_type
      FROM alert_events e LEFT JOIN alert_rules r ON r.id = e.rule_id
      WHERE e.source IS NULL
      LIMIT ${BACKFILL_BATCH}`);
    if (batch.length === 0) return filled;
    for (const row of batch) {
      const payload = parsePayload(row.payload);
      const source = legacyEventSource(row.source_type == null ? null : String(row.source_type), payload);
      const failed = Array.isArray(payload?.failed) && payload.failed.length > 0 ? 1 : 0;
      await exec(db, sql`UPDATE alert_events SET source = ${source}, delivery_failed = ${failed} WHERE id = ${String(row.id)}`);
    }
    filled += batch.length;
  }
}

export const NOTIFY_MIGRATIONS: Migration[] = [
  {
    version: '1.74.0',
    name: 'notify_layer',
    description: 'ADR 0026 — shared notify layer: channel_messages logs every send (and is the claim that stops two replicas sending twice), chat_identities and chat_link_codes link Telegram accounts to CHouse users, and alert_events gains source, channel_ids and delivery_failed so history can be filtered. Existing events get their source filled in.',
    up: async (db) => {
      for (const statement of notifyTableStatements(dialect())) await exec(db, sql.raw(statement));
      for (const column of ALERT_EVENT_COLUMNS) {
        if (await hasColumn(db, 'alert_events', column.name)) continue;
        await exec(db, sql.raw(`ALTER TABLE alert_events ADD COLUMN ${column.name} ${column.type}`));
      }
      for (const statement of notifyIndexStatements(dialect())) await exec(db, sql.raw(statement));
      const filled = await backfillEventSources(db);
      logger.info({ module: 'RBAC', phase: 'migration' }, `[Migration 1.74.0] Created the notify message log and chat identities; filled in the source of ${filled} alert events (${dialect()})`);
    },
    down: async () => { /* forward-only */ },
  },
];
