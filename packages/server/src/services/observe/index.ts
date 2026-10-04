/**
 * Observability platform bootstrap (ADR 0016 §1): registers every collector
 * and starts the collector service plus the remediation worker. Runs in every
 * server process; row leases keep exactly one holder per collector run.
 */

import { logger } from "../../utils/logger";
import { ObserveService } from "./collector";
import { capacityCollector } from "./collectors/capacity";
import { catalogCollector } from "./collectors/catalog";
import { changesCollector } from "./collectors/changes";
import { fleetCollector } from "./collectors/fleet";
import { lineageCollector } from "./collectors/lineage";
import { pipelinesCollector } from "./collectors/pipelines";
import { profilesCollector } from "./collectors/profiles";
import { queriesCollector } from "./collectors/queries";
import { tablesCollector } from "./collectors/tables";
import { usageCollector } from "./collectors/usage";

export const ALL_COLLECTORS = [
  fleetCollector,
  catalogCollector,
  lineageCollector,
  pipelinesCollector,
  tablesCollector,
  usageCollector,
  queriesCollector,
  changesCollector,
  capacityCollector,
  profilesCollector,
];

/** FLEET_POLLER_ENABLED / fleet.poller_enabled are accepted but ignored (ADR 0016 §16, §18). */
export function warnDeprecatedConfig(): void {
  if (process.env.FLEET_POLLER_ENABLED !== undefined && process.env.FLEET_POLLER_ENABLED !== "") {
    logger.warn(
      { module: "Observe", key: "FLEET_POLLER_ENABLED" },
      "FLEET_POLLER_ENABLED (fleet.poller_enabled) is deprecated and ignored; fleet collection is always on. See ADR 0016.",
    );
  }
}

export async function startObservability(): Promise<void> {
  warnDeprecatedConfig();
  const service = ObserveService.getInstance();
  for (const collector of ALL_COLLECTORS) service.register(collector);
  service.start();
  const { RemediationWorker } = await import("../remediation/executor");
  RemediationWorker.getInstance().start();
}

export async function stopObservability(): Promise<void> {
  const { RemediationWorker } = await import("../remediation/executor");
  RemediationWorker.getInstance().stop();
  await ObserveService.getInstance().stop();
}
