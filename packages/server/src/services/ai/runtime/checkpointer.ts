/**
 * LangGraph checkpointer over the RBAC database (ADR 0024 §Phase 1).
 *
 * A chat run's `thread_id` is the run id, so a run that pauses for approval can
 * resume on any replica. Values are serialized with the saver's own serde and
 * stored base64 with their serde type, which keeps SQLite and PostgreSQL
 * identical (no BLOB/BYTEA split).
 */

import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  copyCheckpoint,
  getCheckpointId,
  writesSortKey,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

import { all, one, run, runBatch, sql, str, strOrNull, type Row } from "../../observe/db";

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decode(value: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(str(value), "base64"));
}

function configString(config: RunnableConfig, key: "thread_id" | "checkpoint_ns"): string | undefined {
  const value: unknown = config.configurable?.[key];
  return typeof value === "string" ? value : undefined;
}

export class ChouseCheckpointSaver extends BaseCheckpointSaver {
  private async load(type: unknown, value: unknown): Promise<unknown> {
    return this.serde.loadsTyped(str(type) || "json", decode(value));
  }

  private async pendingWrites(threadId: string, ns: string, checkpointId: string): Promise<CheckpointPendingWrite[]> {
    const writes = await all(sql`
      SELECT task_id, idx, channel, type, value, task_path FROM ai_checkpoint_writes
      WHERE thread_id = ${threadId} AND checkpoint_ns = ${ns} AND checkpoint_id = ${checkpointId}`);
    const ordered = writes
      .map((w) => ({ w, key: writesSortKey(str(w.task_path), str(w.task_id), Number(w.idx)) }))
      .sort((a, b) => compareWritesSortKeys(a.key, b.key));
    return Promise.all(ordered.map(async ({ w }) => [str(w.task_id), str(w.channel), await this.load(w.type, w.value)] as CheckpointPendingWrite));
  }

  private async tuple(row: Row): Promise<CheckpointTuple> {
    const threadId = str(row.thread_id);
    const ns = str(row.checkpoint_ns);
    const checkpointId = str(row.checkpoint_id);
    const parentId = strOrNull(row.parent_checkpoint_id);
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpointId } },
      checkpoint: (await this.load(row.type, row.checkpoint)) as Checkpoint,
      metadata: (await this.load(row.type, row.metadata)) as CheckpointMetadata,
      pendingWrites: await this.pendingWrites(threadId, ns, checkpointId),
    };
    if (parentId) tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: parentId } };
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = configString(config, "thread_id");
    if (!threadId) return undefined;
    const ns = configString(config, "checkpoint_ns") ?? "";
    const checkpointId = getCheckpointId(config);
    const row = checkpointId
      ? await one(sql`SELECT * FROM ai_checkpoints WHERE thread_id = ${threadId} AND checkpoint_ns = ${ns} AND checkpoint_id = ${checkpointId}`)
      : await one(sql`SELECT * FROM ai_checkpoints WHERE thread_id = ${threadId} AND checkpoint_ns = ${ns} ORDER BY checkpoint_id DESC LIMIT 1`);
    return row ? this.tuple(row) : undefined;
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = configString(config, "thread_id");
    const ns = configString(config, "checkpoint_ns");
    const checkpointId = getCheckpointId(config);
    const before = options?.before ? getCheckpointId(options.before) : undefined;
    const conditions = [sql`1 = 1`];
    if (threadId) conditions.push(sql`thread_id = ${threadId}`);
    if (ns !== undefined) conditions.push(sql`checkpoint_ns = ${ns}`);
    if (checkpointId) conditions.push(sql`checkpoint_id = ${checkpointId}`);
    if (before) conditions.push(sql`checkpoint_id < ${before}`);
    const rows = await all(sql`SELECT * FROM ai_checkpoints WHERE ${sql.join(conditions, sql` AND `)} ORDER BY checkpoint_id DESC`);
    let remaining = options?.limit;
    for (const row of rows) {
      const tuple = await this.tuple(row);
      const filter = options?.filter;
      if (filter) {
        const metadata = (tuple.metadata ?? {}) as Record<string, unknown>;
        if (!Object.entries(filter).every(([key, value]) => metadata[key] === value)) continue;
      }
      if (remaining !== undefined) {
        if (remaining <= 0) return;
        remaining -= 1;
      }
      yield tuple;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig> {
    const threadId = configString(config, "thread_id");
    if (!threadId) throw new Error("Checkpoint needs a thread_id");
    const ns = configString(config, "checkpoint_ns") ?? "";
    const parentId = getCheckpointId(config) || null;
    const [type, serializedCheckpoint] = await this.serde.dumpsTyped(copyCheckpoint(checkpoint));
    const [, serializedMetadata] = await this.serde.dumpsTyped(metadata);
    await run(sql`
      INSERT INTO ai_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at)
      VALUES (${threadId}, ${ns}, ${checkpoint.id}, ${parentId}, ${type}, ${encode(serializedCheckpoint)}, ${encode(serializedMetadata)}, ${Date.now()})
      ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
        parent_checkpoint_id = excluded.parent_checkpoint_id, type = excluded.type,
        checkpoint = excluded.checkpoint, metadata = excluded.metadata`);
    return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath?: string): Promise<void> {
    const threadId = configString(config, "thread_id");
    const checkpointId = getCheckpointId(config);
    if (!threadId || !checkpointId) throw new Error("Checkpoint writes need a thread_id and checkpoint_id");
    const ns = configString(config, "checkpoint_ns") ?? "";
    const statements = await Promise.all(writes.map(async ([channel, value], i) => {
      const idx = WRITES_IDX_MAP[channel] ?? i;
      const [type, serialized] = await this.serde.dumpsTyped(value);
      // Special channels (errors, interrupts) overwrite; regular writes keep the first value, as MemorySaver does.
      const onConflict = idx < 0
        ? sql`DO UPDATE SET channel = excluded.channel, type = excluded.type, value = excluded.value, task_path = excluded.task_path`
        : sql`DO NOTHING`;
      return sql`
        INSERT INTO ai_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value, task_path)
        VALUES (${threadId}, ${ns}, ${checkpointId}, ${taskId}, ${idx}, ${channel}, ${type}, ${encode(serialized)}, ${taskPath ?? ""})
        ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id, idx) ${onConflict}`;
    }));
    if (statements.length > 0) await runBatch(statements);
  }

  async deleteThread(threadId: string): Promise<void> {
    await runBatch([
      sql`DELETE FROM ai_checkpoint_writes WHERE thread_id = ${threadId}`,
      sql`DELETE FROM ai_checkpoints WHERE thread_id = ${threadId}`,
    ]);
  }
}

let saver: ChouseCheckpointSaver | null = null;

/** The process-wide saver (stateless apart from its serde). */
export function checkpointSaver(): ChouseCheckpointSaver {
  saver ??= new ChouseCheckpointSaver();
  return saver;
}
