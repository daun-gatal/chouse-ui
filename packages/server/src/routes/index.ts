import { Hono } from "hono";
import auth from "./auth";
import query from "./query";
import explorer from "./explorer";
import metrics from "./metrics";
import savedQueries from "./saved-queries";

const api = new Hono();

// Mount route modules
api.route("/auth", auth);
api.route("/query", query);
api.route("/explorer", explorer);
api.route("/metrics", metrics);
api.route("/saved-queries", savedQueries);

// Health check endpoint
api.get("/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
    },
  });
});

export default api;

