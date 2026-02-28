// monacoConfig.ts
import { createClient } from "@clickhouse/client-web";
import * as monaco from "monaco-editor";
import { formatClickHouseSQL } from "@/lib/formatSql";
import type { IntellisenseData, IntellisenseFunctionInfo } from "@/api/query";
import {
  buildDatabaseStructureFromColumns,
  getTablesInScope,
  parseCTEDefinitions,
  parseQueryContext,
  resolveTableAlias,
  type Column,
  type Database,
  type ParseQueryContextResult,
  type QueryContextKind,
  type Table,
} from "./sqlCompletionUtils";
import {
  createClickHouseMonarchTokenizer,
  createClickHouseLanguageConfig,
  CLICKHOUSE_DATA_TYPES,
  CLICKHOUSE_ENGINES,
  CLICKHOUSE_SETTINGS,
  SQL_SNIPPETS,
} from "./clickhouseLanguage";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorkerUrl: () => string;
    };
  }
}

let isInitialized = false;

interface AppCredential {
  url?: string;
  username?: string;
  password?: string;
  customPath?: string;
}

let client: ReturnType<typeof createClient> | null = null;

// SECURITY WARNING: Storing ClickHouse credentials in localStorage is vulnerable to XSS attacks.
// If an XSS vulnerability exists, attackers can steal credentials from localStorage.
// Consider:
// 1. Using httpOnly cookies for credentials (requires server-side changes)
// 2. Using sessionStorage instead of localStorage (better, but still vulnerable to XSS)
// 3. Never storing passwords in browser storage - use tokens/session IDs instead
// For now, we rely on XSS prevention measures (DOMPurify, CSP headers) to protect credentials.
const appStore = localStorage.getItem("app-storage");
const state = appStore ? (JSON.parse(appStore) as { state?: { credential?: AppCredential } }) : {};
const credential: AppCredential = state.state?.credential ?? {};

function initializeClickHouseClient(
  _appStore: string | null,
  _state: { state?: { credential?: AppCredential } },
  cred: AppCredential
): void {
  if (
    cred &&
    typeof cred.url === "string" &&
    cred.url.trim() !== "" &&
    typeof cred.username === "string" &&
    cred.username.trim() !== ""
  ) {
    client = createClient({
      url: cred.url,
      pathname: cred.customPath,
      username: cred.username,
      password: cred.password ?? "",
    });
  } else {
    if (process.env.NODE_ENV === "development") {
      console.warn("[MonacoConfig] Invalid or missing ClickHouse credentials");
    }
  }
}

try {
  initializeClickHouseClient(appStore, state, credential);
} catch (error) {
  console.error("[MonacoConfig] Error initializing ClickHouse client:", error);
}

export async function retryInitialization(
  retries: number = 3,
  delay: number = 2000
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    if (client) {
      return;
    }
    const latestStore = localStorage.getItem("app-storage");
    const latestState = latestStore
      ? (JSON.parse(latestStore) as { state?: { credential?: AppCredential } })
      : {};
    const latestCred = latestState.state?.credential ?? {};
    initializeClickHouseClient(latestStore, latestState, latestCred);
    if (client) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  console.error("[MonacoConfig] Failed to initialize ClickHouse client after multiple attempts.");
}

export type { Column, Database, ParseQueryContextResult, QueryContextKind, Table, TableInScope } from "./sqlCompletionUtils";
export { buildDatabaseStructureFromColumns, getTablesInScope, parseQueryContext } from "./sqlCompletionUtils";
export type IntellisenseColumn = IntellisenseData["columns"][number];

// Single cache for intellisense
let intellisenseCache: IntellisenseData | null = null;

/**
 * Clear the intellisense cache. Call on logout/connection change so next completion fetches fresh data.
 */
export function clearIntellisenseCache(): void {
  intellisenseCache = null;
}

async function getIntellisenseDataCached(): Promise<IntellisenseData | null> {
  if (intellisenseCache) {
    return intellisenseCache;
  }
  try {
    const { getIntellisenseData } = await import("@/api/query");
    const data = await getIntellisenseData();
    intellisenseCache = data;
    return data;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[MonacoConfig] Failed to fetch intellisense data:", err);
    }
    return null;
  }
}

window.MonacoEnvironment = {
  getWorkerUrl() {
    return new URL("../../worker/monaco-editor-worker.js", import.meta.url)
      .href;
  },
};

function ensureMonacoEnvironment(): void {
  if (typeof window.MonacoEnvironment === "undefined") {
    window.MonacoEnvironment = {
      getWorkerUrl() {
        return new URL("../../worker/monaco-editor-worker.js", import.meta.url)
          .href;
      },
    };
  }
}

// ============================================
// Build function lookup for hover/signature
// ============================================

function buildFunctionMap(
  functions: IntellisenseFunctionInfo[]
): Map<string, IntellisenseFunctionInfo> {
  const map = new Map<string, IntellisenseFunctionInfo>();
  for (const fn of functions) {
    map.set(fn.name.toLowerCase(), fn);
  }
  return map;
}

// ============================================
// Completion Provider
// ============================================

function createCompletionProvider(
  monacoInstance: typeof monaco
): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", " ", "(", ","],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const data = await getIntellisenseDataCached();
      if (!data) {
        return { suggestions: [] };
      }

      const dbStructure = buildDatabaseStructureFromColumns(data.columns);
      const queryContext = parseQueryContext(model.getValue(), position);
      const suggestions: monaco.languages.CompletionItem[] = [];

      // --- Context: SETTINGS → suggest ClickHouse settings ---
      if (queryContext.kind === "afterSettings") {
        for (const setting of CLICKHOUSE_SETTINGS) {
          suggestions.push({
            label: {
              label: setting.name,
              detail: `  ${setting.type}`,
              description: "Setting",
            },
            kind: monacoInstance.languages.CompletionItemKind.Property,
            insertText: `${setting.name} = `,
            detail: `${setting.type}`,
            documentation: setting.description,
            filterText: setting.name,
            sortText: `0_${setting.name}`,
            range,
          });
        }
        return { suggestions };
      }

      // --- Context: ENGINE → suggest ClickHouse engines ---
      if (queryContext.kind === "afterEngine") {
        for (const engine of CLICKHOUSE_ENGINES) {
          suggestions.push({
            label: {
              label: engine,
              description: "Engine",
            },
            kind: monacoInstance.languages.CompletionItemKind.Constructor,
            insertText: engine,
            detail: "Table Engine",
            filterText: engine,
            sortText: `0_${engine}`,
            range,
          });
        }
        return { suggestions };
      }

      // --- Context: Data type position → suggest data types ---
      if (queryContext.kind === "afterDataType") {
        for (const dt of CLICKHOUSE_DATA_TYPES) {
          suggestions.push({
            label: {
              label: dt.name,
              description: "Type",
            },
            kind: monacoInstance.languages.CompletionItemKind.TypeParameter,
            insertText: dt.parametric ? `${dt.name}($0)` : dt.name,
            insertTextRules: dt.parametric
              ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            detail: "Data Type",
            documentation: dt.description,
            filterText: dt.name,
            sortText: `0_${dt.name}`,
            range,
          });
        }
        return { suggestions };
      }

      // --- Context: prefix. → tables from database OR columns from alias/table ---
      if (queryContext.kind === "dbDot" && queryContext.database) {
        const prefix = queryContext.database;
        const db = dbStructure.find((d) => d.name === prefix);

        if (db) {
          for (const tbl of db.children) {
            suggestions.push({
              label: {
                label: tbl.name,
                description: db.name,
              },
              kind: monacoInstance.languages.CompletionItemKind.Struct,
              insertText: tbl.name,
              detail: `Table in ${db.name}`,
              filterText: tbl.name,
              sortText: `0_${tbl.name}`,
              range,
            });
          }
          return { suggestions };
        }

        // Not a database — check if it's a table alias or table name in scope
        const tablesInScope = getTablesInScope(model.getValue(), position);
        const resolved = resolveTableAlias(prefix, tablesInScope);
        if (resolved) {
          const resolvedDb = dbStructure.find(
            (d) => (resolved.database ? d.name === resolved.database : true) && d.children.some((t) => t.name === resolved.table)
          );
          const resolvedTbl = resolvedDb?.children.find((t) => t.name === resolved.table);
          if (resolvedTbl && resolvedDb) {
            for (const col of resolvedTbl.children) {
              suggestions.push({
                label: {
                  label: col.name,
                  detail: `  ${col.type}`,
                  description: `${resolvedDb.name}.${resolvedTbl.name}`,
                },
                kind: monacoInstance.languages.CompletionItemKind.Field,
                insertText: col.name,
                detail: `${resolvedDb.name}.${resolvedTbl.name}`,
                filterText: col.name,
                sortText: `0_${col.name}`,
                range,
              });
            }
            return { suggestions };
          }
        }

        // Check if prefix is a CTE name
        const cteDefinitions = parseCTEDefinitions(model.getValue());
        const cte = cteDefinitions.find((c) => c.name === prefix);
        if (cte) {
          for (const cteTable of cte.tables) {
            const cteDb = dbStructure.find(
              (d) => (cteTable.database ? d.name === cteTable.database : true) && d.children.some((t) => t.name === cteTable.table)
            );
            const cteTbl = cteDb?.children.find((t) => t.name === cteTable.table);
            if (cteTbl && cteDb) {
              for (const col of cteTbl.children) {
                suggestions.push({
                  label: {
                    label: col.name,
                    detail: `  ${col.type}`,
                    description: `CTE ${prefix} → ${cteDb.name}.${cteTbl.name}`,
                  },
                  kind: monacoInstance.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  detail: `CTE ${prefix} → ${cteDb.name}.${cteTbl.name}`,
                  filterText: col.name,
                  sortText: `0_${col.name}`,
                  range,
                });
              }
            }
          }
          if (suggestions.length > 0) return { suggestions };
        }

        // Last fallback: check if prefix matches a table name directly (no alias, not in scope)
        for (const anyDb of dbStructure) {
          const matchTbl = anyDb.children.find((t) => t.name === prefix);
          if (matchTbl) {
            for (const col of matchTbl.children) {
              suggestions.push({
                label: {
                  label: col.name,
                  detail: `  ${col.type}`,
                  description: `${anyDb.name}.${matchTbl.name}`,
                },
                kind: monacoInstance.languages.CompletionItemKind.Field,
                insertText: col.name,
                detail: `${anyDb.name}.${matchTbl.name}`,
                filterText: col.name,
                sortText: `0_${col.name}`,
                range,
              });
            }
            return { suggestions };
          }
        }

        return { suggestions };
      }

      // --- Context: database.table. → show only columns from that table ---
      if (queryContext.kind === "dbTableDot" && queryContext.database && queryContext.table) {
        const db = dbStructure.find((d) => d.name === queryContext.database);
        const tbl = db?.children.find((t) => t.name === queryContext.table);
        if (tbl && db) {
          for (const col of tbl.children) {
            suggestions.push({
              label: {
                label: col.name,
                detail: `  ${col.type}`,
                description: `${db.name}.${tbl.name}`,
              },
              kind: monacoInstance.languages.CompletionItemKind.Field,
              insertText: col.name,
              detail: `${db.name}.${tbl.name}`,
              filterText: col.name,
              sortText: `0_${col.name}`,
              range,
            });
          }
        }
        return { suggestions };
      }

      const isColumnContext = (
        queryContext.kind === "afterSelect" || queryContext.kind === "afterWhere" ||
        queryContext.kind === "afterOn" || queryContext.kind === "afterGroupBy" ||
        queryContext.kind === "afterOrderBy" || queryContext.kind === "afterHaving" ||
        queryContext.kind === "afterPrewhere" || queryContext.kind === "afterUsing"
      );

      // --- Column suggestions from scope tables (prioritized in column contexts) ---
      const columnSuggestionsFromScope: monaco.languages.CompletionItem[] = [];

      if (isColumnContext && queryContext.tablesInScope.length > 0) {
        const usePrefix = queryContext.tablesInScope.length > 1;
        for (const ref of queryContext.tablesInScope) {
          const db = dbStructure.find(
            (d) =>
              (ref.database ? d.name === ref.database : true) && d.children.some((t) => t.name === ref.table)
          );
          const tbl = db?.children.find((t) => t.name === ref.table);
          if (tbl) {
            const labelPrefix = usePrefix && ref.alias ? `${ref.alias}.` : "";
            for (const col of tbl.children) {
              const insertLabel = labelPrefix + col.name;
              columnSuggestionsFromScope.push({
                label: {
                  label: insertLabel,
                  detail: `  ${col.type}`,
                  description: ref.database ? `${ref.database}.${ref.table}` : ref.table,
                },
                kind: monacoInstance.languages.CompletionItemKind.Field,
                insertText: insertLabel,
                detail: ref.database ? `${ref.database}.${ref.table}` : ref.table,
                filterText: col.name,
                sortText: `00_${col.name}`,
                range,
              });
            }
          }
        }
      }

      // --- "All columns" expansion suggestion in SELECT context ---
      if (queryContext.kind === "afterSelect" && queryContext.tablesInScope.length > 0) {
        const usePrefix = queryContext.tablesInScope.length > 1;
        const allColParts: string[] = [];

        for (const ref of queryContext.tablesInScope) {
          const db = dbStructure.find(
            (d) =>
              (ref.database ? d.name === ref.database : true) && d.children.some((t) => t.name === ref.table)
          );
          const tbl = db?.children.find((t) => t.name === ref.table);
          if (tbl) {
            const prefix = usePrefix && ref.alias ? `${ref.alias}.` : "";
            for (const col of tbl.children) {
              allColParts.push(prefix + col.name);
            }
          }
        }

        if (allColParts.length > 0) {
          const allColsText = allColParts.join(",\n  ");
          const tableNames = queryContext.tablesInScope.map((t) => t.alias ?? t.table).join(", ");
          suggestions.push({
            label: {
              label: "* (expand all columns)",
              description: `${allColParts.length} columns from ${tableNames}`,
            },
            kind: monacoInstance.languages.CompletionItemKind.Text,
            insertText: allColsText,
            detail: `Expand to all ${allColParts.length} columns`,
            filterText: "* all columns expand",
            sortText: `00_!`,
            range,
          });
        }
      }

      // --- Fallback: all columns from all tables when in column context but no FROM yet ---
      const allColumnSuggestions: monaco.languages.CompletionItem[] = [];
      if (isColumnContext && queryContext.tablesInScope.length === 0) {
        const seenCols = new Set<string>();
        for (const db of dbStructure) {
          for (const tbl of db.children) {
            for (const col of tbl.children) {
              const colKey = `${col.name}:${col.type}`;
              if (seenCols.has(colKey)) continue;
              seenCols.add(colKey);
              allColumnSuggestions.push({
                label: {
                  label: col.name,
                  detail: `  ${col.type}`,
                  description: `${db.name}.${tbl.name}`,
                },
                kind: monacoInstance.languages.CompletionItemKind.Field,
                insertText: col.name,
                detail: `${db.name}.${tbl.name}`,
                filterText: col.name,
                sortText: `01_${col.name}`,
                range,
              });
            }
          }
        }
      }

      // --- Database/Table/Column hierarchy suggestions ---
      dbStructure.forEach((db: Database) => {
        if (
          !queryContext.database ||
          db.name.toLowerCase().startsWith(queryContext.database.toLowerCase())
        ) {
          if (queryContext.isTypingDatabase || !queryContext.database) {
            suggestions.push({
              label: {
                label: db.name,
                description: "Database",
              },
              kind: monacoInstance.languages.CompletionItemKind.Folder,
              insertText: db.name,
              detail: "Database",
              filterText: db.name,
              sortText: `06_${db.name}`,
              range,
            });
          }

          if (
            queryContext.isTypingDatabase ||
            db.name === queryContext.database
          ) {
            db.children.forEach((tbl: Table) => {
              if (
                !queryContext.table ||
                tbl.name.toLowerCase().startsWith(queryContext.table.toLowerCase())
              ) {
                suggestions.push({
                  label: {
                    label: tbl.name,
                    description: db.name,
                  },
                  kind: monacoInstance.languages.CompletionItemKind.Struct,
                  insertText: tbl.name,
                  detail: `Table in ${db.name}`,
                  filterText: tbl.name,
                  sortText: `05_${tbl.name}`,
                  range,
                });

                if (queryContext.table && tbl.name === queryContext.table) {
                  tbl.children.forEach((col: Column) => {
                    suggestions.push({
                      label: {
                        label: col.name,
                        detail: `  ${col.type}`,
                        description: `${db.name}.${tbl.name}`,
                      },
                      kind: monacoInstance.languages.CompletionItemKind.Field,
                      insertText: col.name,
                      detail: `${db.name}.${tbl.name}`,
                      filterText: col.name,
                      sortText: `01_${col.name}`,
                      range,
                    });
                  });
                }
              }
            });
          }
        }
      });

      // --- Keyword suggestions ---
      const seenKeywords = new Set<string>();
      const keywordSuggestions: monaco.languages.CompletionItem[] = [];
      for (const keyword of data.keywords) {
        if (seenKeywords.has(keyword)) continue;
        seenKeywords.add(keyword);
        keywordSuggestions.push({
          label: keyword,
          kind: monacoInstance.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          filterText: keyword,
          sortText: isColumnContext ? `08_${keyword}` : `02_${keyword}`,
          range,
        });
      }

      // --- Function suggestions (with documentation) ---
      const seenFunctions = new Set<string>();
      const functionSuggestions: monaco.languages.CompletionItem[] = [];
      for (const fn of data.functions) {
        if (seenFunctions.has(fn.name)) continue;
        seenFunctions.add(fn.name);

        const fnKind = fn.is_aggregate
          ? monacoInstance.languages.CompletionItemKind.Method
          : monacoInstance.languages.CompletionItemKind.Function;

        let docValue: string | monaco.IMarkdownString | undefined;
        if (fn.description || fn.syntax) {
          const parts: string[] = [];
          if (fn.syntax) parts.push(`\`\`\`sql\n${fn.syntax}\n\`\`\``);
          if (fn.description) parts.push(fn.description);
          if (fn.is_aggregate) parts.push("*Aggregate function*");
          docValue = { value: parts.join("\n\n") };
        }

        functionSuggestions.push({
          label: {
            label: fn.name,
            detail: fn.is_aggregate ? "  agg()" : "  ()",
          },
          kind: fnKind,
          insertText: `${fn.name}($0)`,
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: fn.is_aggregate ? "Aggregate function" : "Function",
          documentation: docValue,
          filterText: fn.name,
          sortText: isColumnContext ? `02_${fn.name}` : `03_${fn.name}`,
          range,
        });
      }

      // --- SQL Snippet suggestions (only in generic context) ---
      const snippetSuggestions: monaco.languages.CompletionItem[] = [];
      if (queryContext.kind === "generic") {
        for (const snippet of SQL_SNIPPETS) {
          snippetSuggestions.push({
            label: {
              label: snippet.label,
              description: "Snippet",
            },
            kind: monacoInstance.languages.CompletionItemKind.Snippet,
            insertText: snippet.insertText,
            insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: snippet.detail,
            documentation: snippet.documentation ? { value: snippet.documentation } : undefined,
            filterText: snippet.label,
            sortText: `00_${snippet.label}`,
            range,
          });
        }
      }

      // --- Data type suggestions (available in generic context for DDL authoring) ---
      const dataTypeSuggestions: monaco.languages.CompletionItem[] = [];
      if (queryContext.kind === "generic") {
        for (const dt of CLICKHOUSE_DATA_TYPES) {
          dataTypeSuggestions.push({
            label: {
              label: dt.name,
              description: "Type",
            },
            kind: monacoInstance.languages.CompletionItemKind.TypeParameter,
            insertText: dt.parametric ? `${dt.name}($0)` : dt.name,
            insertTextRules: dt.parametric
              ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            detail: "Data Type",
            documentation: dt.description,
            filterText: dt.name,
            sortText: `09_${dt.name}`,
            range,
          });
        }
      }

      // --- Merge all suggestions ---
      const contextOrder = [
        ...snippetSuggestions,
        ...columnSuggestionsFromScope,
        ...allColumnSuggestions,
        ...functionSuggestions,
        ...suggestions,
        ...keywordSuggestions,
        ...dataTypeSuggestions,
      ];

      // Deduplicate
      const seen = new Set<string>();
      const deduped = contextOrder.filter((item) => {
        const labelStr = typeof item.label === "string" ? item.label : item.label.label;
        const insertStr = typeof item.insertText === "string" ? item.insertText : labelStr;
        const key = `${item.kind}:${labelStr}:${insertStr}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { suggestions: deduped };
    },
  };
}

// ============================================
// Hover Provider
// ============================================

function createHoverProvider(
  monacoInstance: typeof monaco
): monaco.languages.HoverProvider {
  return {
    provideHover: async (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const data = await getIntellisenseDataCached();
      if (!data) return null;

      const token = word.word;
      const tokenLower = token.toLowerCase();

      // Check functions
      const fnMap = buildFunctionMap(data.functions);
      const fnInfo = fnMap.get(tokenLower);
      if (fnInfo) {
        const parts: string[] = [];
        if (fnInfo.syntax) {
          parts.push(`\`\`\`sql\n${fnInfo.syntax}\n\`\`\``);
        } else {
          parts.push(`\`\`\`sql\n${fnInfo.name}()\n\`\`\``);
        }
        if (fnInfo.description) parts.push(fnInfo.description);
        if (fnInfo.is_aggregate) parts.push("*Aggregate function*");

        return {
          range: new monacoInstance.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn
          ),
          contents: [{ value: parts.join("\n\n") }],
        };
      }

      // Check if it's a column - resolve from context
      const dbStructure = buildDatabaseStructureFromColumns(data.columns);
      const queryContext = parseQueryContext(model.getValue(), position);

      // Check alias.column pattern: get preceding token
      const lineContent = model.getLineContent(position.lineNumber);
      const beforeWord = lineContent.substring(0, word.startColumn - 1);
      const dotMatch = beforeWord.match(/(\w+)\.\s*$/);

      if (dotMatch) {
        const prefix = dotMatch[1];
        const resolved = resolveTableAlias(prefix, queryContext.tablesInScope);
        if (resolved) {
          const db = dbStructure.find(
            (d) => (resolved.database ? d.name === resolved.database : true) && d.children.some((t) => t.name === resolved.table)
          );
          const tbl = db?.children.find((t) => t.name === resolved.table);
          const col = tbl?.children.find((c) => c.name === token);
          if (col && tbl && db) {
            return {
              range: new monacoInstance.Range(
                position.lineNumber, word.startColumn,
                position.lineNumber, word.endColumn
              ),
              contents: [
                { value: `\`\`\`\n${col.name} ${col.type}\n\`\`\`` },
                { value: `Column in \`${db.name}.${tbl.name}\`` },
              ],
            };
          }
        }
      }

      // Check if token matches a column in any scope table
      if (queryContext.tablesInScope.length > 0) {
        for (const ref of queryContext.tablesInScope) {
          const db = dbStructure.find(
            (d) => (ref.database ? d.name === ref.database : true) && d.children.some((t) => t.name === ref.table)
          );
          const tbl = db?.children.find((t) => t.name === ref.table);
          const col = tbl?.children.find((c) => c.name === token);
          if (col && tbl && db) {
            return {
              range: new monacoInstance.Range(
                position.lineNumber, word.startColumn,
                position.lineNumber, word.endColumn
              ),
              contents: [
                { value: `\`\`\`\n${col.name} ${col.type}\n\`\`\`` },
                { value: `Column in \`${db.name}.${tbl.name}\`` },
              ],
            };
          }
        }
      }

      // Check if token is a table name
      for (const db of dbStructure) {
        const tbl = db.children.find((t) => t.name === token);
        if (tbl) {
          const colCount = tbl.children.length;
          return {
            range: new monacoInstance.Range(
              position.lineNumber, word.startColumn,
              position.lineNumber, word.endColumn
            ),
            contents: [
              { value: `**Table** \`${db.name}.${tbl.name}\`` },
              { value: `${colCount} column${colCount !== 1 ? "s" : ""}` },
            ],
          };
        }
      }

      // Check if token is a database name
      const dbMatch = dbStructure.find((d) => d.name === token);
      if (dbMatch) {
        const tableCount = dbMatch.children.length;
        return {
          range: new monacoInstance.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn
          ),
          contents: [
            { value: `**Database** \`${dbMatch.name}\`` },
            { value: `${tableCount} table${tableCount !== 1 ? "s" : ""}` },
          ],
        };
      }

      // Check data types
      const dataType = CLICKHOUSE_DATA_TYPES.find((dt) => dt.name.toLowerCase() === tokenLower);
      if (dataType) {
        return {
          range: new monacoInstance.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn
          ),
          contents: [
            { value: `**Data Type** \`${dataType.name}\`` },
            { value: dataType.description },
          ],
        };
      }

      return null;
    },
  };
}

// ============================================
// Signature Help Provider
// ============================================

function createSignatureHelpProvider(
  monacoInstance: typeof monaco
): monaco.languages.SignatureHelpProvider {
  return {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],

    provideSignatureHelp: async (model, position) => {
      const data = await getIntellisenseDataCached();
      if (!data) return null;

      const lineContent = model.getLineContent(position.lineNumber);
      const textBefore = lineContent.substring(0, position.column - 1);

      // Find the function name by walking backward past nested parens
      let depth = 0;
      let funcEnd = -1;
      let activeParam = 0;

      for (let i = textBefore.length - 1; i >= 0; i--) {
        const ch = textBefore[i];
        if (ch === ")") {
          depth++;
        } else if (ch === "(") {
          if (depth === 0) {
            funcEnd = i;
            break;
          }
          depth--;
        } else if (ch === "," && depth === 0) {
          activeParam++;
        }
      }

      if (funcEnd < 0) return null;

      const beforeParen = textBefore.substring(0, funcEnd).trimEnd();
      const funcNameMatch = beforeParen.match(/(\w+)$/);
      if (!funcNameMatch) return null;

      const funcName = funcNameMatch[1];
      const fnMap = buildFunctionMap(data.functions);
      const fnInfo = fnMap.get(funcName.toLowerCase());
      if (!fnInfo) return null;

      const signatureLabel = fnInfo.syntax || `${fnInfo.name}(...)`;

      const sig: monaco.languages.SignatureInformation = {
        label: signatureLabel,
        documentation: fnInfo.description ? { value: fnInfo.description } : undefined,
        parameters: [],
      };

      // Parse parameters from syntax like: functionName(arg1, arg2, ...)
      const paramMatch = signatureLabel.match(/\(([^)]*)\)/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1].split(",").map((p) => p.trim());
        sig.parameters = params.map((p) => ({
          label: p,
          documentation: undefined,
        }));
      }

      return {
        value: {
          signatures: [sig],
          activeSignature: 0,
          activeParameter: Math.min(activeParam, (sig.parameters?.length ?? 1) - 1),
        },
        dispose: () => {},
      };
    },
  };
}

// ============================================
// Initialize Monaco
// ============================================

export const initializeMonacoGlobally = async (): Promise<void> => {
  ensureMonacoEnvironment();

  monaco.editor.defineTheme('chouse-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: "keyword", foreground: "569CD6", fontStyle: "bold" },
      { token: "type", foreground: "4EC9B0" },
      { token: "predefined", foreground: "DCDCAA" },
      { token: "identifier.quote", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "number.float", foreground: "B5CEA8" },
      { token: "number.hex", foreground: "B5CEA8" },
      { token: "string", foreground: "CE9178" },
      { token: "string.escape", foreground: "D7BA7D" },
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "operator", foreground: "D4D4D4" },
      { token: "delimiter", foreground: "D4D4D4" },
    ],
    colors: {
      'editor.background': '#14141a',
      'editor.lineHighlightBackground': '#ffffff0a',
      'editorLineNumber.foreground': '#ffffff20',
      'editorLineNumber.activeForeground': '#ffffff60',
      'diffEditor.insertedTextBackground': '#2ea04330',
      'diffEditor.removedTextBackground': '#da363330',
      'diffEditor.diagonalFill': '#ffffff10',
    }
  });

  if (isInitialized) return;

  monaco.languages.register({ id: "sql" });
  monaco.languages.setLanguageConfiguration("sql", createClickHouseLanguageConfig());
  monaco.languages.setMonarchTokensProvider("sql", createClickHouseMonarchTokenizer());

  monaco.languages.registerCompletionItemProvider("sql", createCompletionProvider(monaco));
  monaco.languages.registerHoverProvider("sql", createHoverProvider(monaco));
  monaco.languages.registerSignatureHelpProvider("sql", createSignatureHelpProvider(monaco));

  monaco.languages.registerDocumentFormattingEditProvider("sql", {
    provideDocumentFormattingEdits: (model) => {
      const formatted = formatClickHouseSQL(model.getValue());
      return [
        {
          range: model.getFullModelRange(),
          text: formatted,
        },
      ];
    },
  });

  isInitialized = true;
};

// ============================================
// Editor Options
// ============================================

export interface MonacoEditorOptions {
  fontSize?: number;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  minimap?: { enabled: boolean };
  tabSize?: number;
  padding?: { top: number };
  suggestOnTriggerCharacters?: boolean;
  quickSuggestions?: boolean;
  wordBasedSuggestions?: 'off' | 'allDocuments' | 'matchingDocuments' | 'currentDocument';
  quickSuggestionsDelay?: number;
}

const DEFAULT_MONACO_OPTIONS: Required<MonacoEditorOptions> = {
  fontSize: 14,
  wordWrap: 'off',
  minimap: { enabled: false },
  tabSize: 2,
  padding: { top: 10 },
  suggestOnTriggerCharacters: true,
  quickSuggestions: true,
  wordBasedSuggestions: 'off',
  quickSuggestionsDelay: 50,
};

export async function getMonacoEditorOptions(): Promise<MonacoEditorOptions> {
  try {
    const { rbacUserPreferencesApi } = await import('@/api/rbac');
    const { useRbacStore } = await import('@/stores/rbac');

    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      return DEFAULT_MONACO_OPTIONS;
    }

    const preferences = await rbacUserPreferencesApi.getPreferences();
    const monacoSettings = preferences.workspacePreferences?.monacoSettings as
      | MonacoEditorOptions
      | undefined;

    if (monacoSettings) {
      return {
        ...DEFAULT_MONACO_OPTIONS,
        ...monacoSettings,
        minimap: monacoSettings.minimap !== undefined
          ? { ...DEFAULT_MONACO_OPTIONS.minimap, ...monacoSettings.minimap }
          : DEFAULT_MONACO_OPTIONS.minimap,
        padding: monacoSettings.padding !== undefined
          ? { ...DEFAULT_MONACO_OPTIONS.padding, ...monacoSettings.padding }
          : DEFAULT_MONACO_OPTIONS.padding,
      };
    }

    return DEFAULT_MONACO_OPTIONS;
  } catch (error) {
    console.error('[MonacoConfig] Failed to fetch editor preferences:', error);
    return DEFAULT_MONACO_OPTIONS;
  }
}

export async function updateMonacoEditorOptions(
  options: Partial<MonacoEditorOptions>
): Promise<void> {
  try {
    const { rbacUserPreferencesApi } = await import('@/api/rbac');
    const { useRbacStore } = await import('@/stores/rbac');

    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      return;
    }

    const currentPreferences = await rbacUserPreferencesApi.getPreferences();
    await rbacUserPreferencesApi.updatePreferences({
      workspacePreferences: {
        ...currentPreferences.workspacePreferences,
        monacoSettings: {
          ...((currentPreferences.workspacePreferences?.monacoSettings as MonacoEditorOptions) || {}),
          ...options,
        },
      },
    });
  } catch (error) {
    console.error('[MonacoConfig] Failed to update editor preferences:', error);
  }
}

// ============================================
// Editor Factory
// ============================================

export const createMonacoEditor = async (
  container: HTMLElement,
  theme: string
): Promise<monaco.editor.IStandaloneCodeEditor> => {
  const options = await getMonacoEditorOptions();

  const editor = monaco.editor.create(container, {
    language: "sql",
    theme: theme === 'vs-dark' ? 'chouse-dark' : theme || "vs-dark",
    automaticLayout: true,
    fontSize: options.fontSize,
    wordWrap: options.wordWrap,
    minimap: options.minimap,
    tabSize: options.tabSize,
    padding: options.padding,
    suggestOnTriggerCharacters: options.suggestOnTriggerCharacters,
    quickSuggestions: options.quickSuggestions,
    wordBasedSuggestions: options.wordBasedSuggestions,
    quickSuggestionsDelay: options.quickSuggestionsDelay,
    suggest: {
      showSnippets: true,
      snippetsPreventQuickSuggestions: false,
      showIcons: true,
      showStatusBar: true,
      preview: true,
    },
    parameterHints: {
      enabled: true,
      cycle: true,
    },
  });

  return editor;
};

export const createMonacoDiffEditor = async (
  container: HTMLElement,
  theme: string,
  options: monaco.editor.IDiffEditorConstructionOptions = {}
): Promise<monaco.editor.IStandaloneDiffEditor> => {
  const monacoOptions = await getMonacoEditorOptions();

  const diffEditor = monaco.editor.createDiffEditor(container, {
    theme: theme === 'vs-dark' ? 'chouse-dark' : theme || "vs-dark",
    automaticLayout: true,
    fontSize: monacoOptions.fontSize,
    wordWrap: monacoOptions.wordWrap,
    minimap: monacoOptions.minimap,
    padding: monacoOptions.padding,
    readOnly: false,
    originalEditable: false,
    renderSideBySide: true,
    ...options,
  });

  return diffEditor;
};
