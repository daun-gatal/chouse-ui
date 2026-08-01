/**
 * Shared configuration generation counter (ADR 0010).
 *
 * The SSO config and the derived password-login state are cached in process
 * memory for the hot path (the login route and the public config endpoint), and
 * were rebuilt only by the pod that served an admin mutation. Behind multiple
 * replicas that meant an admin disabling password login, or removing an SSO
 * provider, left every *other* pod serving the old answer indefinitely — there
 * is no TTL on those caches.
 *
 * A single row holds a monotonic counter. Admin mutations bump it; every replica
 * polls it and rebuilds when it moves. Divergence is bounded by the poll
 * interval instead of being unbounded.
 */
import { sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { rawAll, rawRun, toNumber } from "./raw";

/** Read the current generation. Returns 0 if the table is not migrated yet. */
export async function readConfigGeneration(): Promise<number> {
  try {
    const rows = await rawAll(sql`SELECT generation FROM rbac_config_generation WHERE id = 1`);
    return rows.length > 0 ? toNumber(rows[0].generation) : 0;
  } catch (error) {
    logger.warn(
      { module: "Auth", err: error instanceof Error ? error.message : String(error) },
      "Failed to read config generation"
    );
    return 0;
  }
}

/**
 * Bump the generation so other replicas rebuild their caches. Called after any
 * admin mutation that changes SSO providers or auth posture.
 *
 * Failure is logged, not thrown: the mutation itself already succeeded and is
 * durable, and the pod that served it refreshes its own cache directly. A failed
 * bump degrades to the pre-ADR-0010 behaviour (other pods stay stale) rather
 * than failing the admin's request.
 */
export async function bumpConfigGeneration(): Promise<void> {
  try {
    await rawRun(sql`
      UPDATE rbac_config_generation
      SET generation = generation + 1, updated_at = ${Date.now()}
      WHERE id = 1
    `);
  } catch (error) {
    logger.error(
      { module: "Auth", err: error instanceof Error ? error.message : String(error) },
      "Failed to bump config generation — other replicas may serve stale auth config until restart"
    );
  }
}
