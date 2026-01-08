/// <reference types="vite/client" />

declare const __CH_UI_VERSION__: string;

declare global {
  interface Window {
    env?: {
      VITE_CLICKHOUSE_URLS: string[];
    };
    MonacoEnvironment?: {
      getWorkerUrl?: (moduleId: string, label: string) => string;
    };
  }
}