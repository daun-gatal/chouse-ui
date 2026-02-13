import React, { useState, useMemo } from 'react';
import { FileCode2, Copy, Check, Sparkles, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import ExplainInfoHeader from './ExplainInfoHeader';

interface SyntaxViewProps {
  content: string | null | undefined;
  originalQuery?: string;
}

// SQL keyword categories for highlighting
const SQL_KEYWORDS = {
  clauses: ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'WITH', 'AS', 'PREWHERE', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT'],
  joins: ['JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'GLOBAL', 'ANY', 'ALL', 'ASOF'],
  operators: ['AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS', 'NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'],
  functions: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'COALESCE', 'NULLIF', 'IF', 'MULTIIF', 'CAST', 'TOSTRING', 'TOINT', 'TOFLOAT', 'TODATE', 'TODATETIME', 'NOW', 'TODAY', 'FORMATDATETIME', 'DATENAME', 'DATEDIFF', 'DATEADD', 'EXTRACT', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'SUBSTRING', 'CONCAT', 'REPLACE', 'SPLITBYCHAR', 'ARRAYMAP', 'ARRAYFILTER', 'GROUPARRAY', 'UNIQ', 'UNIQEXACT', 'ARGMAX', 'ARGMIN', 'QUANTILE', 'MEDIAN', 'TOPK'],
  types: ['INT', 'INTEGER', 'BIGINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'STRING', 'VARCHAR', 'CHAR', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'ARRAY', 'TUPLE', 'MAP', 'NULLABLE', 'LOWCARDINALITY', 'UUID', 'FIXEDSTRING', 'ENUM', 'IPV4', 'IPV6'],
  modifiers: ['ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'BY', 'ON', 'USING', 'OVER', 'PARTITION', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW', 'MATERIALIZED', 'ALIAS', 'SETTINGS', 'FORMAT'],
};

type TokenType = 'clause' | 'join' | 'operator' | 'function' | 'type' | 'modifier' | 'string' | 'number' | 'comment' | 'identifier' | 'punctuation' | 'default';

interface Token {
  type: TokenType;
  value: string;
}

// Tokenize SQL for syntax highlighting
function tokenizeSQL(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    // Skip whitespace (preserve it)
    if (/\s/.test(sql[i])) {
      let ws = '';
      while (i < sql.length && /\s/.test(sql[i])) {
        ws += sql[i++];
      }
      tokens.push({ type: 'default', value: ws });
      continue;
    }

    // String literals
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let str = quote;
      i++;
      while (i < sql.length && sql[i] !== quote) {
        if (sql[i] === '\\' && i + 1 < sql.length) {
          str += sql[i++];
        }
        str += sql[i++];
      }
      if (i < sql.length) str += sql[i++];
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Comments (-- or /* */)
    if (sql[i] === '-' && sql[i + 1] === '-') {
      let comment = '';
      while (i < sql.length && sql[i] !== '\n') {
        comment += sql[i++];
      }
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    if (sql[i] === '/' && sql[i + 1] === '*') {
      let comment = '';
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        comment += sql[i++];
      }
      if (i < sql.length) comment += sql[i++] + sql[i++];
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // Numbers
    if (/\d/.test(sql[i]) || (sql[i] === '.' && /\d/.test(sql[i + 1] || ''))) {
      let num = '';
      while (i < sql.length && /[\d.eE+-]/.test(sql[i])) {
        num += sql[i++];
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Punctuation
    if (/[(),;.*=<>!+\-/%]/.test(sql[i])) {
      tokens.push({ type: 'punctuation', value: sql[i++] });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_`]/.test(sql[i])) {
      let word = '';

      // Handle backtick-quoted identifiers
      if (sql[i] === '`') {
        word = '`';
        i++;
        while (i < sql.length && sql[i] !== '`') {
          word += sql[i++];
        }
        if (i < sql.length) word += sql[i++];
        tokens.push({ type: 'identifier', value: word });
        continue;
      }

      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
        word += sql[i++];
      }

      const upper = word.toUpperCase();

      // Check keyword categories
      if (SQL_KEYWORDS.clauses.includes(upper)) {
        tokens.push({ type: 'clause', value: word });
      } else if (SQL_KEYWORDS.joins.includes(upper)) {
        tokens.push({ type: 'join', value: word });
      } else if (SQL_KEYWORDS.operators.includes(upper)) {
        tokens.push({ type: 'operator', value: word });
      } else if (SQL_KEYWORDS.functions.includes(upper)) {
        tokens.push({ type: 'function', value: word });
      } else if (SQL_KEYWORDS.types.includes(upper)) {
        tokens.push({ type: 'type', value: word });
      } else if (SQL_KEYWORDS.modifiers.includes(upper)) {
        tokens.push({ type: 'modifier', value: word });
      } else {
        tokens.push({ type: 'identifier', value: word });
      }
      continue;
    }

    // Default: single character
    tokens.push({ type: 'default', value: sql[i++] });
  }

  return tokens;
}

// Token styling
const TOKEN_STYLES: Record<TokenType, string> = {
  clause: 'text-blue-400 font-semibold',
  join: 'text-purple-400 font-semibold',
  operator: 'text-yellow-400',
  function: 'text-cyan-400',
  type: 'text-orange-400',
  modifier: 'text-pink-400',
  string: 'text-green-400',
  number: 'text-emerald-400',
  comment: 'text-zinc-500 italic',
  identifier: 'text-zinc-200',
  punctuation: 'text-zinc-400',
  default: 'text-zinc-300',
};

// SQL Formatter - beautifies SQL with proper indentation
function formatSQL(sql: string): string {
  // Normalize whitespace first
  let normalized = sql.replace(/\s+/g, ' ').trim();

  // Keywords that should start on a new line (no indent)
  const newlineKeywords = [
    'SELECT', 'FROM', 'WHERE', 'PREWHERE', 'GROUP BY', 'HAVING',
    'ORDER BY', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT',
    'WITH'
  ];

  // Keywords that should start on new line with indent
  const indentedKeywords = [
    'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN',
    'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
    'JOIN', 'AND', 'OR'
  ];

  // Build regex patterns (longer matches first)
  const newlinePattern = newlineKeywords
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/\s+/g, '\\s+'))
    .join('|');

  const indentedPattern = indentedKeywords
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/\s+/g, '\\s+'))
    .join('|');

  // Add newlines before major clauses
  normalized = normalized.replace(
    new RegExp(`\\s+(${newlinePattern})\\b`, 'gi'),
    '\n$1'
  );

  // Add newlines and indentation for JOINs and logical operators
  normalized = normalized.replace(
    new RegExp(`\\s+(${indentedPattern})\\b`, 'gi'),
    '\n    $1'
  );

  // Format comma-separated items (columns in SELECT, etc.)
  // Add newline after commas in SELECT clause (before FROM)
  const lines = normalized.split('\n');
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Check if this is a SELECT line
    if (/^SELECT\b/i.test(line)) {
      // Find where FROM starts (might be on same line or next line)
      const fromIndex = line.toUpperCase().indexOf(' FROM ');
      if (fromIndex === -1) {
        // FROM is on another line, format SELECT columns
        const selectPart = line.replace(/^SELECT\s+/i, '');
        const columns = splitByCommaOutsideParens(selectPart);

        if (columns.length > 1) {
          formattedLines.push('SELECT');
          columns.forEach((col, idx) => {
            const comma = idx < columns.length - 1 ? ',' : '';
            formattedLines.push(`    ${col.trim()}${comma}`);
          });
          continue;
        }
      } else {
        // FROM is on same line, format SELECT columns
        const selectPart = line.substring(7, fromIndex).trim();
        const fromPart = line.substring(fromIndex + 1);
        const columns = splitByCommaOutsideParens(selectPart);

        if (columns.length > 1) {
          formattedLines.push('SELECT');
          columns.forEach((col, idx) => {
            const comma = idx < columns.length - 1 ? ',' : '';
            formattedLines.push(`    ${col.trim()}${comma}`);
          });
          formattedLines.push(fromPart.trim());
          continue;
        }
      }
    }

    formattedLines.push(line);
  }

  return formattedLines.join('\n').trim();
}

// Helper to split by comma, but not inside parentheses
function splitByCommaOutsideParens(str: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of str) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    result.push(current);
  }

  return result;
}

const SyntaxView: React.FC<SyntaxViewProps> = ({ content, originalQuery }) => {
  const [copied, setCopied] = useState(false);

  const tokens = useMemo(() => {
    if (!content) return [];
    return tokenizeSQL(content);
  }, [content]);

  // Format the SQL with proper indentation and structure
  const formattedContent = useMemo(() => {
    if (!content) return '';
    return formatSQL(content);
  }, [content]);

  const formattedTokens = useMemo(() => {
    return tokenizeSQL(formattedContent);
  }, [formattedContent]);

  const handleCopy = async () => {
    if (content) {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No syntax data available.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ExplainInfoHeader type="syntax" />

      {/* Copy button header */}
      <div className="flex-shrink-0 flex items-center justify-end px-4 py-1.5 border-b border-zinc-800 bg-zinc-900/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1 text-green-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Syntax Highlighted Code */}
      <div className="flex-1 overflow-auto p-4 bg-zinc-950/50">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          {/* Line numbers + code */}
          <div className="flex">
            {/* Line numbers */}
            <div className="flex-shrink-0 bg-zinc-900/80 border-r border-zinc-800 px-3 py-4 select-none">
              {formattedContent.split('\n').map((_, i) => (
                <div key={i} className="text-xs text-zinc-600 text-right leading-6 h-6">
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Code with syntax highlighting */}
            <div className="flex-1 p-4 overflow-x-auto">
              <pre className="font-mono text-sm leading-6">
                {formattedTokens.map((token, i) => (
                  <span key={i} className={cn(TOKEN_STYLES[token.type])}>
                    {token.value}
                  </span>
                ))}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900/30 px-4 py-2">
        <div className="flex flex-wrap gap-4 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-zinc-500">Clauses</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-zinc-500">Joins</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="text-zinc-500">Functions</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-zinc-500">Strings</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-zinc-500">Numbers</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="text-zinc-500">Operators</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyntaxView;
