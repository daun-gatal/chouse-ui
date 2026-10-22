/**
 * Time on dashboard charts (ADR 0023 §8). A panel's x values are ClickHouse
 * Date/DateTime strings in a zone: the column type's own (`DateTime('UTC')`),
 * or else the session zone the run reported. Annotations, compare, bands and
 * range selection all work in UTC milliseconds, so x values are converted
 * here — never guessed in the browser's zone.
 *
 * NOTE: mirrors src/lib/viz/time.ts in the browser; both are
 * tested against the same cases.
 */

const ZONE_IN_TYPE = /DateTime(?:64)?\((?:\s*\d+\s*,)?\s*'([^']+)'\s*\)/;
const TIME_TYPE = /^(Nullable\(|LowCardinality\()*(Date|Date32|DateTime|DateTime64)\b/;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;

/** Whether a ClickHouse type is a date or time. */
export function isTimeType(type: string): boolean {
  return TIME_TYPE.test(type);
}

/** The zone a time column's values are in: its type's own, else the run's. Null when neither is known. */
export function zoneOfColumn(type: string, runZone: string | null): string | null {
  const own = ZONE_IN_TYPE.exec(type);
  return own ? own[1] : runZone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(zone, f);
  }
  return f;
}

/** How far `zone` is ahead of UTC at the instant `utcMs`, in milliseconds. */
export function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * A ClickHouse date or date-time string in `zone`, as UTC milliseconds — or
 * null when it is not one (or the zone is unknown).
 */
export function toUtcMs(value: unknown, zone: string): number | null {
  if (typeof value !== "string") return null;
  const m = NAIVE.exec(value.trim());
  if (!m) return null;
  const fraction = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)) + fraction;
  try {
    // The offset at the naive instant, corrected once: right on both sides of a DST change.
    const first = naive - zoneOffsetMs(zone, naive);
    return naive - zoneOffsetMs(zone, first);
  } catch {
    return null;
  }
}

/**
 * The index of the bucket that holds `atMs`: the last x at or before it,
 * within one interval. Null when it falls outside the chart.
 */
export function bucketIndex(xsMs: Array<number | null>, atMs: number, intervalMs: number): number | null {
  let found: number | null = null;
  for (let i = 0; i < xsMs.length; i++) {
    const x = xsMs[i];
    if (x !== null && x <= atMs && (found === null || x >= (xsMs[found] as number))) found = i;
  }
  if (found === null) return null;
  return atMs < (xsMs[found] as number) + intervalMs ? found : null;
}

/** The index of the x nearest `atMs`, if within half an interval (compare: buckets a day or week apart). */
export function nearestIndex(xsMs: Array<number | null>, atMs: number, intervalMs: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < xsMs.length; i++) {
    const x = xsMs[i];
    if (x === null) continue;
    if (best === null || Math.abs(x - atMs) < Math.abs((xsMs[best] as number) - atMs)) best = i;
  }
  return best !== null && Math.abs((xsMs[best] as number) - atMs) <= intervalMs / 2 ? best : null;
}
