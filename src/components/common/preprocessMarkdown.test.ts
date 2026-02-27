/**
 * Unit tests for preprocessMarkdown (AI chat markdown normalisation).
 * See AiChatBubble.tsx JSDoc for the list of normalized quirks.
 */

import { describe, it, expect } from 'vitest';
import { preprocessMarkdown } from './AiChatBubble';

describe('preprocessMarkdown', () => {
  describe('leading whitespace', () => {
    it('strips leading blank lines', () => {
      expect(preprocessMarkdown('\n\nhello')).toBe('hello');
    });

    it('strips leading spaces on the first line', () => {
      expect(preprocessMarkdown('          Here\'s the SQL query:')).toBe(
        "Here's the SQL query:"
      );
    });

    it('strips leading blank lines and leading spaces on first line', () => {
      expect(preprocessMarkdown('\n  \n  First line')).toBe('First line');
    });
  });

  describe('line endings', () => {
    it('normalizes \\r\\n to \\n', () => {
      expect(preprocessMarkdown('a\r\nb')).toBe('a\nb');
    });

    it('normalizes \\r to \\n', () => {
      expect(preprocessMarkdown('a\rb')).toBe('a\nb');
    });

    it('leaves plain \\n unchanged', () => {
      expect(preprocessMarkdown('a\nb')).toBe('a\nb');
    });
  });

  describe('literal \\n and <br> outside tables', () => {
    it('converts literal \\n to real newlines', () => {
      expect(preprocessMarkdown('hello\\nworld')).toBe('hello\nworld');
    });

    it('converts <br> to newlines', () => {
      expect(preprocessMarkdown('hello<br>world')).toBe('hello  \nworld');
    });

    it('converts <br/> and <br />', () => {
      expect(preprocessMarkdown('a<br/>b')).toBe('a  \nb');
      expect(preprocessMarkdown('a<br />b')).toBe('a  \nb');
    });
  });

  describe('headings', () => {
    it('adds space after # when missing', () => {
      expect(preprocessMarkdown('##Heading')).toBe('## Heading');
    });

    it('adds space for h1–h6', () => {
      expect(preprocessMarkdown('#Title')).toBe('# Title');
      expect(preprocessMarkdown('######Title')).toBe('###### Title');
    });

    it('leaves correct headings unchanged', () => {
      expect(preprocessMarkdown('## Heading')).toBe('## Heading');
    });
  });

  describe('code fences', () => {
    it('leaves content inside fences unchanged', () => {
      const input = '```\n  code with\\n literal\n```';
      expect(preprocessMarkdown(input)).toBe(input);
    });

    it('splits closing fence line with trailing content', () => {
      const input = '```\ncode\n```  trailing';
      expect(preprocessMarkdown(input)).toBe('```\ncode\n```\ntrailing');
    });

    it('splits opening fence line with trailing content', () => {
      const input = '```sql  stray';
      expect(preprocessMarkdown(input)).toBe('```sql\nstray');
    });

    it('trims fence lines so fence is alone (content inside unchanged)', () => {
      // Leading space on opening fence is trimmed; closing fence line is trimmed to fence only
      const input = '  ```\ncode\n  ```  ';
      const out = preprocessMarkdown(input);
      expect(out).toContain('```');
      expect(out).toContain('code');
      expect(out.split('\n')[0]).toBe('```');
      expect(out.split('\n').filter((l) => l.trim() === '```').length).toBe(2);
    });
  });

  describe('tables', () => {
    it('collapses literal \\n in table cells to spaces', () => {
      const input = '| A | B |\n| --- | --- |\n| x\\ny | z |';
      expect(preprocessMarkdown(input)).toContain('| x y | z |');
    });

    it('collapses <br> in table cells to spaces', () => {
      const input = '| A | B |\n| --- | --- |\n| x<br>y | z |';
      expect(preprocessMarkdown(input)).toContain('| x y | z |');
    });

    it('normalizes row cell count to match header (trim extra)', () => {
      const input = '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |';
      expect(preprocessMarkdown(input)).toBe(
        '| A | B |\n| --- | --- |\n| 1 | 2 |'
      );
    });

    it('normalizes row cell count to match header (pad with empty)', () => {
      const input = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |';
      // Third cell is empty string when padded
      expect(preprocessMarkdown(input)).toBe(
        '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |  |'
      );
    });

    it('pads separator row with --- when shorter than header', () => {
      const input = '| A | B | C |\n| --- | --- |\n| 1 | 2 | 3 |';
      expect(preprocessMarkdown(input)).toBe(
        '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |'
      );
    });
  });

  describe('edge cases', () => {
    it('returns empty string unchanged', () => {
      expect(preprocessMarkdown('')).toBe('');
    });

    it('handles multiple headings in one text', () => {
      const input = '#One\n\n##Two\n\n###Three';
      expect(preprocessMarkdown(input)).toBe('# One\n\n## Two\n\n### Three');
    });

    it('does not alter heading inside code fence', () => {
      const input = '```\n#NoSpace\n```';
      expect(preprocessMarkdown(input)).toBe(input);
    });
  });
});
