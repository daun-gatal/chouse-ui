/**
 * Chat composer helpers (ADR 0024): attachments the selected model accepts,
 * and `/skill:` commands that pin a skill's instructions for a turn. The
 * server applies the same limits; these give the user the answer before upload.
 */

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type InputModality = 'image' | 'pdf';
export type AttachmentKind = 'text' | 'image' | 'pdf';

const TEXT_TYPES: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  sql: 'application/sql',
};
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The MIME type the server expects; browsers report none (or a vendor one) for .sql, .md and .log. */
export function attachmentMimeType(file: { name: string; type: string }): string {
  const byExtension = TEXT_TYPES[extension(file.name)];
  if (byExtension) return byExtension;
  return file.type || 'application/octet-stream';
}

export function attachmentKind(file: { name: string; type: string }): AttachmentKind | null {
  const type = attachmentMimeType(file);
  if (Object.values(TEXT_TYPES).includes(type) || type === 'text/x-sql') return 'text';
  if (IMAGE_TYPES.includes(type)) return 'image';
  if (type === 'application/pdf') return 'pdf';
  return null;
}

/** The file picker's `accept` list for the selected model. */
export function attachmentAccept(modalities: readonly InputModality[]): string {
  const accept = Object.keys(TEXT_TYPES).map((ext) => `.${ext}`);
  if (modalities.includes('image')) accept.push(...IMAGE_TYPES);
  if (modalities.includes('pdf')) accept.push('application/pdf', '.pdf');
  return accept.join(',');
}

/** What the user can attach to this model, for the button's tooltip. */
export function attachmentHint(modalities: readonly InputModality[]): string {
  const kinds = ['CSV, JSON, SQL or text files'];
  if (modalities.includes('image')) kinds.unshift('images');
  if (modalities.includes('pdf')) kinds.splice(kinds.length - 1, 0, 'PDFs');
  return `Attach ${kinds.join(', ')} (up to ${MAX_ATTACHMENTS}, 5 MB each)`;
}

/** Why a file cannot be attached, or null when it can. */
export function attachmentProblem(file: { name: string; type: string; size: number }, modalities: readonly InputModality[], attached: number): string | null {
  if (attached >= MAX_ATTACHMENTS) return `You can attach up to ${MAX_ATTACHMENTS} files per message.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is larger than 5 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  const kind = attachmentKind(file);
  if (!kind) return `${file.name} can't be attached. Attach images, PDFs, or CSV, JSON, SQL, Markdown or text files.`;
  if (kind === 'image' && !modalities.includes('image')) return 'The selected model doesn\'t read images. Pick another model, or ask an admin to allow images for it.';
  if (kind === 'pdf' && !modalities.includes('pdf')) return 'The selected model doesn\'t read PDFs. Pick another model, or ask an admin to allow PDFs for it.';
  return null;
}

/** Base64 content of a file, without the data-URL prefix. */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

const SKILL_COMMAND = /(^|\s)\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;

/**
 * Split `/skill:name` commands out of a message. Unknown names stay in the text
 * (they may be meant literally). A message that was only commands asks the
 * agent to use those skills.
 */
export function parseSkillCommands(text: string, known: readonly string[]): { message: string; skills: string[] } {
  const skills: string[] = [];
  const message = text.replace(SKILL_COMMAND, (match: string, lead: string, name: string) => {
    if (!known.includes(name)) return match;
    if (!skills.includes(name)) skills.push(name);
    return lead;
  }).replace(/[ \t]{2,}/g, ' ').trim();
  if (!message && skills.length > 0) return { message: `Use the ${skills.join(' and ')} skill${skills.length > 1 ? 's' : ''}.`, skills };
  return { message, skills };
}

/** The `/…` command being typed at the caret, or null — what the skill picker filters on. */
export function skillQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)\/(?:skill:)?([a-z0-9-]*)$/.exec(before);
  if (!match) return null;
  const start = before.length - match[0].length + match[1].length;
  return { start, query: match[2] };
}

/** Replace the command being typed with a complete `/skill:name ` token. */
export function insertSkillCommand(text: string, caret: number, name: string): { text: string; caret: number } {
  const at = skillQueryAt(text, caret);
  const start = at ? at.start : caret;
  const token = `/skill:${name} `;
  return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length };
}
