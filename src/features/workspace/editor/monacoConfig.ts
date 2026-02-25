// monacoConfig.ts
import { createClient } from "@clickhouse/client-web";
import * as monaco from "monaco-editor";
import { format } from "sql-formatter";
import type { IntellisenseData } from "@/api/query";
import {
  buildDatabaseStructureFromColumns,
  parseQueryContext,
  type Column,
  type Database,
  type ParseQueryContextResult,
  type QueryContextKind,
  type Table,
} from "./sqlCompletionUtils";

// Add this declaration to extend the Window interface
declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorkerUrl: () => string;
    };
  }
}

let isInitialized = false;

// Credential shape from app-storage (minimal for type safety)
interface AppCredential {
  url?: string;
  username?: string;
  password?: string;
  customPath?: string;
}

// Initialize ClickHouse client (used by retryInitialization; completion uses API)
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

// Retry initialization function
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

// Re-export for consumers that import from monacoConfig
export type { Column, Database, ParseQueryContextResult, QueryContextKind, Table, TableInScope } from "./sqlCompletionUtils";
export { buildDatabaseStructureFromColumns, getTablesInScope, parseQueryContext } from "./sqlCompletionUtils";
export type IntellisenseColumn = IntellisenseData["columns"][number];

// Single cache for intellisense (replaces dbStructureCache, functionsCache, keywordsCache)
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

// Setting up the Monaco Environment to use the editor worker
window.MonacoEnvironment = {
  getWorkerUrl() {
    return new URL("../../worker/monaco-editor-worker.js", import.meta.url)
      .href;
  },
};

// Ensure the Monaco Environment is initialized
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

// Initialize Monaco editor with ClickHouse SQL language features
export const initializeMonacoGlobally = async () => {
  ensureMonacoEnvironment();

  // Define custom dark theme - Always define/update to ensure colors are correct
  monaco.editor.defineTheme('chouse-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
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

  // Register the SQL language
  monaco.languages.register({ id: "sql" });

  // Set language configuration for SQL
  monaco.languages.setLanguageConfiguration("sql", {
    brackets: [
      ["(", ")"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  // Set monarch tokens provider for SQL syntax highlighting
  monaco.languages.setMonarchTokensProvider("sql", {
    keywords: [
      "SELECT",
      "FROM",
      "WHERE",
      "ORDER BY",
      "GROUP BY",
      "LIMIT",
      "JOIN",
      "INSERT",
      "UPDATE",
      "DELETE",
      "CREATE",
      "ALTER",
      "DROP",
      "TABLE",
      "INDEX",
      "VIEW",
      "TRIGGER",
      "PROCEDURE",
      "FUNCTION",
      "DATABASE",
    ],
    operators: [
      "=",
      ">",
      "<",
      "<=",
      ">=",
      "<>",
      "!=",
      "AND",
      "OR",
      "NOT",
      "LIKE",
      "IN",
      "BETWEEN",
    ],
    tokenizer: {
      root: [
        [
          /[a-zA-Z_]\w*/,
          { cases: { "@keywords": "keyword", "@default": "identifier" } },
        ],
        [/[<>!=]=?/, "operator"],
        [/[0-9]+/, "number"],
        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
        [/'/, { token: "string.quote", bracket: "@open", next: "@string2" }],
        [/--.*$/, "comment"],
      ],
      string: [
        [/[^"]+/, "string"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],
      string2: [
        [/[^']+/, "string"],
        [/'/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],
      comment: [
        [/[^-]+/, "comment"],
        [/--/, "comment"],
      ],
    },
  });

  // Register completion item provider for SQL
  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
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

      // Column-level: suggest columns from FROM/JOIN tables when in SELECT/WHERE/ON
      const columnSuggestionsFromScope: monaco.languages.CompletionItem[] = [];
      if (
        (queryContext.kind === "afterSelect" || queryContext.kind === "afterWhere" || queryContext.kind === "afterOn") &&
        queryContext.tablesInScope.length > 0
      ) {
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
              const label = labelPrefix + col.name;
              columnSuggestionsFromScope.push({
                label,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: label,
                detail: ref.database ? `${ref.database}.${ref.table}.${col.type}` : `${ref.table}.${col.type}`,
                filterText: col.name,
                sortText: `4_${label}`,
                range,
              });
            }
          }
        }
      }

      dbStructure.forEach((db: Database) => {
        if (
          !queryContext.database ||
          db.name.toLowerCase().startsWith(queryContext.database.toLowerCase())
        ) {
          if (queryContext.isTypingDatabase || !queryContext.database) {
            suggestions.push({
              label: db.name,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: db.name,
              detail: "Database",
              filterText: db.name,
              sortText: `2_${db.name}`,
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
                  label: tbl.name,
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: tbl.name,
                  detail: `Table in ${db.name}`,
                  filterText: tbl.name,
                  sortText: `3_${tbl.name}`,
                  range,
                });

                if (queryContext.table && tbl.name === queryContext.table) {
                  tbl.children.forEach((col: Column) => {
                    suggestions.push({
                      label: col.name,
                      kind: monaco.languages.CompletionItemKind.Field,
                      insertText: col.name,
                      detail: `${db.name}.${tbl.name}.${col.type}`,
                      filterText: col.name,
                      sortText: `4_${col.name}`,
                      range,
                    });
                  });
                }
              }
            });
          }
        }
      });

      const keywordSuggestions: monaco.languages.CompletionItem[] = data.keywords.map(
        (keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          filterText: keyword,
          sortText: `0_${keyword}`,
          range,
        })
      );

      const functionSuggestions: monaco.languages.CompletionItem[] = data.functions.map(
        (fn) => ({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${fn}()`,
          filterText: fn,
          sortText: `1_${fn}`,
          range,
        })
      );

      // Context-aware order: in FROM/JOIN prefer tables; in SELECT/WHERE/ON prefer columns (from scope) and functions
      const contextOrder =
        queryContext.kind === "afterFrom" || queryContext.kind === "afterJoin"
          ? [...suggestions, ...functionSuggestions, ...keywordSuggestions]
          : queryContext.kind === "afterSelect" || queryContext.kind === "afterWhere" || queryContext.kind === "afterOn"
            ? [...columnSuggestionsFromScope, ...functionSuggestions, ...suggestions, ...keywordSuggestions]
            : [...keywordSuggestions, ...functionSuggestions, ...suggestions];

      return { suggestions: contextOrder };
    },
  });

  // Use sql formatter for formatting SQL code using import { format } from "sql-formatter";
  monaco.languages.registerDocumentFormattingEditProvider("sql", {
    provideDocumentFormattingEdits: (model) => {
      const formatted = format(model.getValue(), { language: "sql" });
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

// Default Monaco editor options
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

/**
 * Get Monaco editor options from user preferences or defaults
 */
export async function getMonacoEditorOptions(): Promise<MonacoEditorOptions> {
  try {
    // Try to import the API (avoid circular dependency)
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

/**
 * Update Monaco editor options in user preferences
 */
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

// Create a Monaco Editor instance
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
  });

  return editor;
};

// Create a Monaco Diff Editor instance
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
    readOnly: false, // Allow interaction, but we can set specific models to read-only if needed
    originalEditable: false,
    renderSideBySide: true,
    ...options, // Spread passed options to override defaults
  });

  return diffEditor;
};
