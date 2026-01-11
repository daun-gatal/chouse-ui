import { Hono } from "hono";

const config = new Hono();

/**
 * GET /config
 * Returns public configuration for the frontend
 * This allows Docker environment variables to be accessed by the frontend
 */
config.get("/", (c) => {
  // Parse preset URLs from comma-separated string
  const presetUrlsRaw = process.env.CLICKHOUSE_PRESET_URLS || "";
  const presetUrls = presetUrlsRaw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  // Get default values
  const defaultUrl = process.env.CLICKHOUSE_DEFAULT_URL || "";
  const defaultUser = process.env.CLICKHOUSE_DEFAULT_USER || "default";

  return c.json({
    success: true,
    data: {
      // ClickHouse connection defaults
      clickhouse: {
        defaultUrl,
        defaultUser,
        presetUrls,
      },
      // App metadata
      app: {
        name: "CHouse UI",
        version: process.env.VERSION || "dev",
      },
    },
  });
});

export default config;

