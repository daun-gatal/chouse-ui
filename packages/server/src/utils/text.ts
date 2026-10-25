/**
 * A one-line headline from free text (an error message, a SQL statement):
 * the first non-empty line with whitespace collapsed, cut to `max` characters
 * at a word boundary and ended with an ellipsis when cut.
 */
export function headline(text: string, max: number): string {
  const line = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l.length > 0) ?? "";
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  const cut = chars.slice(0, Math.max(0, max - 1)).join("");
  // Back up to the last space when it keeps most of the text; a single long
  // token (an identifier, a URL) is cut mid-word instead of emptied.
  const atWordEnd = chars[max - 1] === " ";
  const space = cut.lastIndexOf(" ");
  const base = (atWordEnd || space < cut.length * 0.6 ? cut : cut.slice(0, space)).replace(/[\s,;:.]+$/, "");
  return `${base || cut}…`;
}
