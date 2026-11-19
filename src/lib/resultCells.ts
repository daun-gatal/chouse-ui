import { format as formatDate } from "date-fns";

/** How one ClickHouse result value is shown in a grid cell. */
export interface ResultCell {
  /** Plain text for the cell. Render it as text, never as HTML. */
  text: string;
  /** `cell-*` class that colours the value by kind. */
  className: string;
  /** Full value for the hover title (untruncated JSON for objects). */
  title: string;
}

/** Objects and arrays longer than this are cut short in the cell; the title keeps all of it. */
export const OBJECT_PREVIEW_LENGTH = 50;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Formats a number with the viewer's digit grouping but without the default
 * 3-decimal rounding, which showed 1.23456789 as 1.235 and 1.5e-7 as 0.
 */
function formatNumber(value: number): string {
  // 20 fraction digits is the most Intl allows everywhere; smaller magnitudes
  // would round to 0, so keep their exponent form (5e-324).
  if (value !== 0 && Math.abs(value) < 1e-20) return String(value);
  return value.toLocaleString(undefined, { maximumFractionDigits: 20 });
}

/**
 * Turns a result value into the text a grid cell shows. Cells render the
 * text as text: a string such as `<b>x</b>` or `a<b` is data and must appear
 * exactly as ClickHouse returned it.
 */
export function formatResultCell(value: unknown): ResultCell {
  if (value === null || value === undefined) {
    return { text: "NULL", className: "cell-null", title: "NULL" };
  }

  if (typeof value === "number") {
    return { text: formatNumber(value), className: "cell-number", title: String(value) };
  }

  if (typeof value === "boolean") {
    const text = value ? "TRUE" : "FALSE";
    return { text, className: "cell-boolean", title: text };
  }

  if (value instanceof Date || (typeof value === "string" && ISO_DATE_TIME.test(value))) {
    try {
      const date = value instanceof Date ? value : new Date(value);
      const raw = value instanceof Date ? value.toISOString() : value;
      return { text: formatDate(date, "yyyy-MM-dd HH:mm:ss"), className: "cell-date", title: raw };
    } catch {
      // Invalid dates throw RangeError from date-fns or toISOString.
      const raw = String(value);
      return { text: raw, className: "cell-string", title: raw };
    }
  }

  if (typeof value === "object") {
    const json = JSON.stringify(value);
    const text = json.length > OBJECT_PREVIEW_LENGTH ? `${json.substring(0, OBJECT_PREVIEW_LENGTH)}...` : json;
    return { text, className: "cell-object-preview", title: JSON.stringify(value, null, 2) };
  }

  const text = String(value);
  return { text, className: "cell-string", title: text };
}
