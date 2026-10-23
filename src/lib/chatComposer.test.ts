import { describe, expect, it } from 'vitest';

import {
  attachmentAccept,
  attachmentHint,
  attachmentKind,
  attachmentMimeType,
  attachmentProblem,
  insertSkillCommand,
  MAX_ATTACHMENT_BYTES,
  parseSkillCommands,
  readAsBase64,
  skillQueryAt,
} from './chatComposer';

describe('attachments', () => {
  it('maps file names browsers give no type to the type the server expects', () => {
    expect(attachmentMimeType({ name: 'q.SQL', type: '' })).toBe('application/sql');
    expect(attachmentMimeType({ name: 'notes.md', type: 'text/x-markdown' })).toBe('text/markdown');
    expect(attachmentMimeType({ name: 'a.png', type: 'image/png' })).toBe('image/png');
    expect(attachmentMimeType({ name: 'blob', type: '' })).toBe('application/octet-stream');
  });

  it('classifies text, images and PDFs, and nothing else', () => {
    expect(attachmentKind({ name: 'a.csv', type: 'text/csv' })).toBe('text');
    expect(attachmentKind({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image');
    expect(attachmentKind({ name: 'a.pdf', type: 'application/pdf' })).toBe('pdf');
    expect(attachmentKind({ name: 'a.exe', type: 'application/x-msdownload' })).toBeNull();
    expect(attachmentKind({ name: 'a.svg', type: 'image/svg+xml' })).toBeNull();
  });

  it('accepts only what the model reads', () => {
    expect(attachmentAccept([])).not.toContain('image/png');
    expect(attachmentAccept(['image'])).toContain('image/png');
    expect(attachmentAccept(['pdf'])).toContain('.pdf');
    expect(attachmentHint([])).toBe('Attach CSV, JSON, SQL or text files (up to 3, 5 MB each)');
    expect(attachmentHint(['image', 'pdf'])).toBe('Attach images, PDFs, CSV, JSON, SQL or text files (up to 3, 5 MB each)');
  });

  it('explains why a file cannot be attached', () => {
    const csv = { name: 'a.csv', type: 'text/csv', size: 10 };
    expect(attachmentProblem(csv, [], 0)).toBeNull();
    expect(attachmentProblem(csv, [], 3)).toBe('You can attach up to 3 files per message.');
    expect(attachmentProblem({ ...csv, size: MAX_ATTACHMENT_BYTES + 1 }, [], 0)).toBe('a.csv is larger than 5 MB.');
    expect(attachmentProblem({ ...csv, size: 0 }, [], 0)).toBe('a.csv is empty.');
    expect(attachmentProblem({ name: 'a.png', type: 'image/png', size: 5 }, [], 0)).toContain("doesn't read images");
    expect(attachmentProblem({ name: 'a.png', type: 'image/png', size: 5 }, ['image'], 0)).toBeNull();
    expect(attachmentProblem({ name: 'a.pdf', type: 'application/pdf', size: 5 }, ['image'], 0)).toContain("doesn't read PDFs");
    expect(attachmentProblem({ name: 'a.zip', type: 'application/zip', size: 5 }, ['image', 'pdf'], 0)).toContain("can't be attached");
  });

  it('reads a file as plain base64', async () => {
    expect(await readAsBase64(new Blob(['id,amount\n1,9.5']))).toBe(btoa('id,amount\n1,9.5'));
  });
});

describe('skill commands', () => {
  const known = ['query-optimization', 'schema-diagnosis'];

  it('pins known skills and removes their commands from the message', () => {
    expect(parseSkillCommands('/skill:query-optimization why is this slow?', known)).toEqual({ message: 'why is this slow?', skills: ['query-optimization'] });
    expect(parseSkillCommands('check /skill:schema-diagnosis this table /skill:schema-diagnosis', known)).toEqual({ message: 'check this table', skills: ['schema-diagnosis'] });
  });

  it('keeps unknown commands and paths as text', () => {
    expect(parseSkillCommands('/skill:nope hi', known)).toEqual({ message: '/skill:nope hi', skills: [] });
    expect(parseSkillCommands('read /var/log/skill:x', known)).toEqual({ message: 'read /var/log/skill:x', skills: [] });
  });

  it('turns a message of only commands into a request to use the skills', () => {
    expect(parseSkillCommands('/skill:query-optimization /skill:schema-diagnosis', known)).toEqual({
      message: 'Use the query-optimization and schema-diagnosis skills.',
      skills: ['query-optimization', 'schema-diagnosis'],
    });
  });

  it('finds the command being typed and completes it', () => {
    expect(skillQueryAt('/', 1)).toEqual({ start: 0, query: '' });
    expect(skillQueryAt('hi /skill:que', 13)).toEqual({ start: 3, query: 'que' });
    expect(skillQueryAt('hi /que', 7)).toEqual({ start: 3, query: 'que' });
    expect(skillQueryAt('a/b', 3)).toBeNull();
    expect(skillQueryAt('/skill:x done', 13)).toBeNull();
    expect(insertSkillCommand('hi /que and', 7, 'query-optimization')).toEqual({ text: 'hi /skill:query-optimization  and', caret: 29 });
    expect(insertSkillCommand('', 0, 'x')).toEqual({ text: '/skill:x ', caret: 9 });
  });
});
