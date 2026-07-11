import { readFileSync } from "node:fs";

function referencesUrl(filename: string): URL {
  return new URL(`../references/${filename}`, import.meta.url);
}

export function readReferenceSync(filename: string): string {
  try {
    return readFileSync(referencesUrl(filename).pathname, "utf-8").trim();
  } catch {
    return "";
  }
}
