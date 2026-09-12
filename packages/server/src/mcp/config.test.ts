import { describe, expect, it } from "bun:test";
import {
  DEFAULT_TOOLSETS,
  loadMcpConfig,
} from "./config";

const PROD = { NODE_ENV: "production" } as Record<string, string | undefined>;
const DEV = { NODE_ENV: "development" } as Record<string, string | undefined>;

describe("loadMcpConfig", () => {
  it("is disabled by default in production and enabled in development", () => {
    expect(loadMcpConfig(PROD).config?.enabled).toBe(false);
    expect(loadMcpConfig(DEV).config?.enabled).toBe(true);
  });

  it("respects explicit MCP_ENABLED", () => {
    expect(loadMcpConfig({ ...PROD, MCP_ENABLED: "true" }).config?.enabled).toBe(true);
    expect(loadMcpConfig({ ...DEV, MCP_ENABLED: "false" }).config?.enabled).toBe(false);
  });

  it("defaults host to localhost and port to 8752", () => {
    const config = loadMcpConfig(PROD).config;
    expect(config?.host).toBe("localhost");
    expect(config?.port).toBe(8752);
  });

  it("reads MCP_PORT", () => {
    expect(loadMcpConfig({ ...PROD, MCP_PORT: "9000" }).config?.port).toBe(9000);
  });

  it("rejects an invalid MCP_PORT with an error", () => {
    const result = loadMcpConfig({ ...PROD, MCP_PORT: "http" });
    expect(result.config).toBeUndefined();
    expect(result.errors.some((error) => error.includes("MCP_PORT"))).toBe(true);
  });

  it("defaults to the read-only toolset set", () => {
    expect(loadMcpConfig(PROD).config?.toolsets).toEqual(DEFAULT_TOOLSETS);
  });

  it("parses MCP_TOOLSETS as a CSV list", () => {
    const config = loadMcpConfig({ ...PROD, MCP_TOOLSETS: "core, explore ,query" }).config;
    expect(config?.toolsets).toEqual(["core", "explore", "query"]);
  });

  it("rejects unknown toolsets", () => {
    const result = loadMcpConfig({ ...PROD, MCP_TOOLSETS: "core,nope" });
    expect(result.config).toBeUndefined();
    expect(result.errors.some((error) => error.includes("nope"))).toBe(true);
  });

  it("keeps writes and destructive disabled by default", () => {
    const config = loadMcpConfig(PROD).config;
    expect(config?.allowWrites).toBe(false);
    expect(config?.allowDestructive).toBe(false);
  });

  it("rejects MCP_ALLOW_DESTRUCTIVE without MCP_ALLOW_WRITES", () => {
    const result = loadMcpConfig({ ...PROD, MCP_ALLOW_DESTRUCTIVE: "true" });
    expect(result.config).toBeUndefined();
    expect(result.errors.some((error) => error.includes("MCP_ALLOW_WRITES"))).toBe(true);
  });

  it("accepts the full destructive stack when writes are also enabled", () => {
    const config = loadMcpConfig({
      ...PROD,
      MCP_ALLOW_WRITES: "true",
      MCP_ALLOW_DESTRUCTIVE: "true",
      MCP_TOOLSETS: "core,destructive",
    }).config;
    expect(config?.allowWrites).toBe(true);
    expect(config?.allowDestructive).toBe(true);
  });

  it("parses MCP_ALLOWED_ORIGINS as a CSV list", () => {
    const config = loadMcpConfig({
      ...PROD,
      MCP_ALLOWED_ORIGINS: "https://a.example, https://b.example",
    }).config;
    expect(config?.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
  });

  it("clamps MCP_TIMEOUT_SECONDS to the 1..600 window", () => {
    expect(loadMcpConfig({ ...PROD, MCP_TIMEOUT_SECONDS: "0" }).config?.timeoutSeconds).toBe(1);
    expect(loadMcpConfig({ ...PROD, MCP_TIMEOUT_SECONDS: "9999" }).config?.timeoutSeconds).toBe(600);
    expect(loadMcpConfig({ ...PROD, MCP_TIMEOUT_SECONDS: "120" }).config?.timeoutSeconds).toBe(120);
    expect(loadMcpConfig(PROD).config?.timeoutSeconds).toBe(60);
  });
});
