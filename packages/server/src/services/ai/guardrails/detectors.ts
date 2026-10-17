/**
 * Built-in detectors for the `pattern` guardrail (ADR 0022 §2).
 *
 * Each finds candidate spans with a regex and, where a regex alone matches too
 * much, confirms them (Luhn for cards, a real address parse for IPs, a digit
 * count for phones). Detectors return spans; redaction is done by the caller.
 */

import { isIPv4, isIPv6 } from "net";

export type Span = [start: number, end: number];

export interface Detector {
  id: string;
  label: string;
  group: "pii" | "secret";
  /** Placeholder name, e.g. EMAIL → "[EMAIL]". */
  token: string;
  find(text: string): Span[];
}

function spans(re: RegExp, text: string, accept: (match: RegExpExecArray) => Span | null = (m) => [m.index, m.index + m[0].length]): Span[] {
  const found: Span[] = [];
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (let m = global.exec(text); m !== null; m = global.exec(text)) {
    if (m[0].length === 0) {
      global.lastIndex++;
      continue;
    }
    const span = accept(m);
    if (span) found.push(span);
  }
  return found;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const DETECTORS: readonly Detector[] = [
  {
    id: "email", label: "Email address", group: "pii", token: "EMAIL",
    find: (t) => spans(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, t),
  },
  {
    id: "card", label: "Card number", group: "pii", token: "CARD",
    find: (t) => spans(/(?<![\d.])\d(?:[ -]?\d){12,18}(?![\d.])/g, t, (m) => {
      const digits = m[0].replace(/[ -]/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? [m.index, m.index + m[0].length] : null;
    }),
  },
  {
    id: "phone", label: "Phone number", group: "pii", token: "PHONE",
    find: (t) => spans(/(?<![\w.+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}[ .-]\d{3,4}(?:[ .-]\d{3,4})?(?![\w.])/g, t, (m) => {
      const digits = m[0].replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 15 ? [m.index, m.index + m[0].length] : null;
    }),
  },
  {
    id: "ip", label: "IP address", group: "pii", token: "IP",
    find: (t) => [
      ...spans(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, t, (m) => (isIPv4(m[0]) ? [m.index, m.index + m[0].length] : null)),
      ...spans(/(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])/g, t, (m) => (isIPv6(m[0]) ? [m.index, m.index + m[0].length] : null)),
    ],
  },
  {
    id: "url", label: "URL", group: "pii", token: "URL",
    find: (t) => spans(/\bhttps?:\/\/[^\s"'<>]+/gi, t),
  },
  {
    id: "aws_key", label: "AWS access key", group: "secret", token: "AWS_KEY",
    find: (t) => spans(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, t),
  },
  {
    id: "chouse_token", label: "CHouse access token", group: "secret", token: "CHOUSE_TOKEN",
    find: (t) => spans(/\bch_pat_[A-Za-z0-9_-]{20,}/g, t),
  },
  {
    id: "jwt", label: "JSON web token", group: "secret", token: "JWT",
    find: (t) => spans(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, t),
  },
  {
    id: "private_key", label: "Private key", group: "secret", token: "PRIVATE_KEY",
    find: (t) => spans(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, t),
  },
  {
    // Only the password part of scheme://user:password@host.
    id: "password_in_url", label: "Password in a URL", group: "secret", token: "PASSWORD",
    find: (t) => spans(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/gi, t, (m) => {
      const start = m.index + m[0].length - 1 - m[1].length;
      return [start, start + m[1].length];
    }),
  },
  {
    id: "bearer_token", label: "Bearer token", group: "secret", token: "TOKEN",
    find: (t) => spans(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, t),
  },
];

export const DETECTOR_IDS: readonly string[] = DETECTORS.map((d) => d.id);

export function detectorById(id: string): Detector | undefined {
  return DETECTORS.find((d) => d.id === id);
}
