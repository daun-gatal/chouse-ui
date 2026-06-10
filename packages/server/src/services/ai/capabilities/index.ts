/**
 * Capability registry — THE single source of truth for AI features.
 *
 * Adding a feature = add one entry here. The unified /ai/invoke route looks
 * capabilities up by id, enforces their permission, validates input, and runs
 * them through the shared engine.
 */

import type { AnyCapability } from "../types";
import { optimizeQueryCapability } from "./optimizeQuery";
import { debugQueryCapability } from "./debugQuery";
import { checkOptimizeCapability } from "./checkOptimize";
import { optimizeLogCapability } from "./optimizeLog";
import {
  diagnoseErrorCapability,
  diagnosePartsCapability,
  diagnoseSchemaCapability,
} from "./diagnose";
import { fleetScanCapability } from "./fleetScan";
import { chatCapability } from "./chat";

export const CAPABILITIES = {
  "optimize-query": optimizeQueryCapability,
  "debug-query": debugQueryCapability,
  "check-optimize": checkOptimizeCapability,
  "optimize-log": optimizeLogCapability,
  "diagnose-error": diagnoseErrorCapability,
  "diagnose-parts": diagnosePartsCapability,
  "diagnose-schema": diagnoseSchemaCapability,
  "fleet-scan": fleetScanCapability,
  "chat": chatCapability,
} as const satisfies Record<string, AnyCapability>;

export type CapabilityId = keyof typeof CAPABILITIES;

/** Look up a capability by id (returns undefined for unknown ids). */
export function getCapability(id: string): AnyCapability | undefined {
  return (CAPABILITIES as Record<string, AnyCapability>)[id];
}

/** All capability ids (for the GET /ai/capabilities surface). */
export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as CapabilityId[];
