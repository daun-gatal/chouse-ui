import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "uplot/dist/uPlot.min.css";
import "./features/metrics/components/uplot.css";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/providers/QueryProvider";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { log } from "@/lib/log";

// Polyfill for crypto.randomUUID if not available
if (typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = function () {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (
        parseInt(c) ^
        (crypto.getRandomValues(new Uint8Array(1))[0] &
          (15 >> (parseInt(c) / 4)))
      ).toString(16)
    ) as `${string}-${string}-${string}-${string}-${string}`;
  };
}

// Development helper: Inject window.env from Vite env vars if not present
if (import.meta.env.DEV && !window.env) {
  window.env = {
    VITE_CLICKHOUSE_URLS: (import.meta.env.VITE_CLICKHOUSE_URLS || "")
      .split(",")
      .filter((url: string) => url.trim() !== ""),
  };
  log.debug("Development mode: Injected window.env from .env file");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <Toaster
          richColors
          toastOptions={{ duration: 2000, closeButton: true }}
          expand={true}
        />
        <App />
      </QueryProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
