// Shared pieces of the lab's sample-data loader (seed.ts) and smoke check
// (smoke.ts). Runs on the Bun inside the CHouse image and under Vitest, so it
// uses only web-standard APIs (fetch, URL, setTimeout) and no imports.

/**
 * The ClickHouse servers the lab runs, one per version under test. Each becomes
 * a connection in CHouse UI named after its version. The first is the default
 * connection, where the example content (dashboards, alerts, jobs) lives. The
 * hosts are service names on the compose network (compose.yml).
 */
export interface LabServer {
  /** Major.minor version the server runs, shown in its connection name. */
  version: string;
  /** Compose service name and host CHouse UI uses to reach it. */
  host: string;
  /** Connection name in CHouse UI. */
  connectionName: string;
}

export const LAB_SERVERS: readonly LabServer[] = [
  { version: "26.5", host: "clickhouse-26-5", connectionName: "Lab ClickHouse 26.5" },
  { version: "26.3", host: "clickhouse-26-3", connectionName: "Lab ClickHouse 26.3" },
  { version: "25.8", host: "clickhouse-25-8", connectionName: "Lab ClickHouse 25.8" },
  { version: "23.8", host: "clickhouse-23-8", connectionName: "Lab ClickHouse 23.8" },
];

/** The default server's connection: where the example content is attached. */
export const LAB_DEFAULT_SERVER: LabServer = LAB_SERVERS[0];
export const LAB_CONNECTION_NAME = LAB_DEFAULT_SERVER.connectionName;

/** Prefix of the AI provider the lab registers when the visitor brings a key. */
export const LAB_AI_PREFIX = "Lab";

/** Rows the loader writes to shop.orders_raw on first start. */
export const SAMPLE_ORDER_ROWS = 2_000_000;

/** Settings the loader and smoke check run with, read from the environment. */
export interface LabConfig {
  chouseUrl: string;
  clickhouseUser: string;
  clickhousePassword: string;
  adminIdentifier: string;
  adminPassword: string;
}

type Env = Record<string, string | undefined>;

/** Reads the lab settings, failing fast with the names of anything missing. */
export function readConfig(env: Env): LabConfig {
  const missing = ["LAB_ADMIN_PASSWORD", "CLICKHOUSE_PASSWORD"].filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new LabError(`Missing ${missing.join(", ")}. Start the lab with up.sh, which generates them.`);
  }
  return {
    chouseUrl: trimSlash(env.LAB_CHOUSE_URL || "http://chouse-ui:5521"),
    clickhouseUser: "admin",
    clickhousePassword: env.CLICKHOUSE_PASSWORD ?? "",
    adminIdentifier: "admin",
    adminPassword: env.LAB_ADMIN_PASSWORD ?? "",
  };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The AI provider and model the lab registers when a key is present. */
export interface AiChoice {
  providerType: "anthropic" | "openai";
  providerName: string;
  modelId: string;
  contextWindow: number;
  apiKey: string;
}

/**
 * Picks the AI provider from the visitor's Codespaces secrets. Anthropic wins
 * when both keys are set; `LAB_AI_MODEL` overrides the model. No key means
 * the lab runs with AI off, which is not an error.
 */
export function chooseAi(env: Env): AiChoice | null {
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  const openai = env.OPENAI_API_KEY?.trim();
  const model = env.LAB_AI_MODEL?.trim();
  if (anthropic) {
    return {
      providerType: "anthropic",
      providerName: `${LAB_AI_PREFIX} Anthropic`,
      modelId: model || "claude-haiku-5-5",
      contextWindow: 200_000,
      apiKey: anthropic,
    };
  }
  if (openai) {
    return {
      providerType: "openai",
      providerName: `${LAB_AI_PREFIX} OpenAI`,
      modelId: model || "gpt-5-mini",
      contextWindow: 400_000,
      apiKey: openai,
    };
  }
  return null;
}

/** An error with the HTTP status and API error code that caused it, if any. */
export class LabError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "LabError";
    this.status = status;
    this.code = code;
  }
}

/** The fetch signature the lab uses, so tests can pass a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const NETWORK_ATTEMPTS = 5;
const NETWORK_RETRY_MS = 2_000;

/**
 * Retries only when the request never got an HTTP response (the service is
 * still starting). Any HTTP status, including 429, is returned to the caller:
 * retrying a login could lock the visitor out of their own lab.
 */
async function fetchWithRetry(fetchImpl: FetchLike, url: string, init: RequestInit, retryMs: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt++) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < NETWORK_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new LabError(`Could not reach ${new URL(url).host}: ${reason}`);
}

/** Runs one SQL statement on one of the lab's ClickHouse servers over HTTP and returns the response text. */
export async function clickhouseQuery(
  cfg: LabConfig,
  sql: string,
  fetchImpl: FetchLike,
  retryMs = NETWORK_RETRY_MS,
  server: LabServer = LAB_DEFAULT_SERVER,
): Promise<string> {
  const response = await fetchWithRetry(
    fetchImpl,
    `http://${server.host}:8123/`,
    {
      method: "POST",
      headers: {
        "X-ClickHouse-User": cfg.clickhouseUser,
        "X-ClickHouse-Key": cfg.clickhousePassword,
      },
      body: sql,
    },
    retryMs,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new LabError(`ClickHouse returned ${response.status}: ${text.trim().slice(0, 300)}`, response.status);
  }
  return text;
}

/** True for a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string field from an unknown JSON object. */
export function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

/** Reads a boolean field from an unknown JSON object. */
export function booleanField(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

/** Reads an array field from an unknown JSON object (empty when absent). */
export function arrayField(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const field = value[key];
  return Array.isArray(field) ? field : [];
}

/** Reads a nested object field from an unknown JSON object. */
export function objectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return isRecord(field) ? field : undefined;
}

/**
 * A small client for the CHouse UI HTTP API. Every request sends the
 * `X-Requested-With` header the API requires from non-browser callers, and
 * the bearer token once `login` has run.
 */
export class ChouseApi {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike,
    private readonly retryMs = NETWORK_RETRY_MS,
  ) {}

  /** Logs in once. A 429 is reported, never retried. */
  async login(identifier: string, password: string): Promise<void> {
    const data = await this.request("POST", "/api/rbac/auth/login", { identifier, password });
    const token = stringField(objectField(data, "tokens"), "accessToken");
    if (!token) throw new LabError("Login succeeded but returned no access token");
    this.token = token;
  }

  /**
   * Sends one request and returns the `data` member of the response. The raw
   * body is returned when it has no envelope (for example ClickHouse JSON).
   */
  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    const response = await fetchWithRetry(
      this.fetchImpl,
      `${this.baseUrl}${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      this.retryMs,
    );
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok || booleanField(parsed, "success") === false) {
      const error = isRecord(parsed) ? parsed.error : undefined;
      const code = stringField(error, "code");
      const message = typeof error === "string" ? error : stringField(error, "message");
      const hint = response.status === 429 ? " (rate limited; wait 15 minutes before retrying)" : "";
      throw new LabError(
        `${method} ${path} failed with ${response.status}: ${message || text.slice(0, 200) || response.statusText}${hint}`,
        response.status,
        response.status === 429 ? "RATE_LIMITED" : code,
      );
    }
    return isRecord(parsed) && "data" in parsed ? parsed.data : parsed;
  }
}

/** One line of the loader's or smoke check's report. */
export interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

/** Runs one named step, turning a thrown error into a failed result. */
export async function runStep(step: string, fn: () => Promise<string>): Promise<StepResult> {
  try {
    return { step, ok: true, detail: await fn() };
  } catch (error) {
    return { step, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
