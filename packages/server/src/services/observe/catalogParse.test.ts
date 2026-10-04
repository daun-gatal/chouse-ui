import { describe, expect, it } from "bun:test";

import {
  classifyObject,
  parseBuffer,
  parseDictionaryCreate,
  parseDictionarySource,
  parseDistributed,
  parseEngineSource,
  parseMvTarget,
  parseSelectSources,
  summarizeLocation,
} from "./catalogParse";

describe("classifyObject", () => {
  it("distinguishes refreshable and incremental materialized views", () => {
    expect(classifyObject("MaterializedView", "CREATE MATERIALIZED VIEW a.b TO a.c AS SELECT 1", null)).toBe("materialized_view");
    expect(classifyObject("MaterializedView", "CREATE MATERIALIZED VIEW a.b REFRESH EVERY 1 HOUR TO a.c AS SELECT 1", null)).toBe("refreshable_view");
  });

  it("maps every ingestion engine family", () => {
    expect(classifyObject("Kafka", "", null)).toBe("queue_engine");
    expect(classifyObject("RabbitMQ", "", null)).toBe("queue_engine");
    expect(classifyObject("NATS", "", null)).toBe("queue_engine");
    expect(classifyObject("S3Queue", "", null)).toBe("object_storage_queue");
    expect(classifyObject("AzureQueue", "", null)).toBe("object_storage_queue");
    expect(classifyObject("PostgreSQL", "", null)).toBe("external_table");
    expect(classifyObject("Distributed", "", null)).toBe("distributed");
    expect(classifyObject("Buffer", "", null)).toBe("buffer");
    expect(classifyObject("ReplacingMergeTree", "", "MaterializedPostgreSQL")).toBe("replicated_database_table");
    expect(classifyObject("MergeTree", "", "Atomic")).toBe("table");
  });
});

describe("materialized view parsing", () => {
  const q = "CREATE MATERIALIZED VIEW shop.mv_orders_agg TO analytics.orders_daily (`day` Date) AS SELECT toDate(created_at) AS day, country FROM shop.orders_raw AS o LEFT JOIN customers c ON o.id = c.id GROUP BY day, country";

  it("finds the TO target, ignoring TO inside the SELECT", () => {
    expect(parseMvTarget(q, "shop")).toEqual({ database: "analytics", table: "orders_daily" });
    expect(parseMvTarget("CREATE MATERIALIZED VIEW db.v ENGINE = MergeTree ORDER BY x AS SELECT x FROM t", "db")).toBeNull();
  });

  it("finds FROM / JOIN sources with default-database qualification", () => {
    expect(parseSelectSources(q, "shop").tables).toEqual([
      { database: "shop", table: "orders_raw" },
      { database: "shop", table: "customers" },
    ]);
  });

  it("captures table functions without credentials", () => {
    const refreshable = "CREATE MATERIALIZED VIEW ref.fx REFRESH EVERY 1 HOUR TO ref.fx_rates AS SELECT * FROM url('https://user:secret@ecb.example/rates.csv?key=abc', CSV)";
    expect(parseSelectSources(refreshable, "ref").tableFunctions).toEqual([{ name: "url", ref: "https://ecb.example/rates.csv" }]);
  });
});

describe("engine sources", () => {
  it("reads the upstream for each engine without exposing secrets", () => {
    expect(parseEngineSource("Kafka", "Kafka SETTINGS kafka_broker_list = 'b:9092', kafka_topic_list = 'orders.v2', kafka_group_name = 'g'")).toEqual({ kind: "kafka", ref: "orders.v2" });
    expect(parseEngineSource("Kafka", "Kafka('b:9092', 'orders', 'g', 'JSONEachRow')")).toEqual({ kind: "kafka", ref: "orders" });
    expect(parseEngineSource("RabbitMQ", "RabbitMQ SETTINGS rabbitmq_host_port = 'r:5672', rabbitmq_exchange_name = 'clicks'")).toEqual({ kind: "rabbitmq", ref: "clicks" });
    expect(parseEngineSource("NATS", "NATS SETTINGS nats_url = 'n:4222', nats_subjects = 'events.*'")).toEqual({ kind: "nats", ref: "events.*" });
    expect(parseEngineSource("S3Queue", "S3Queue('https://k:s@bucket.s3/raw/*.json', 'JSONEachRow')")).toEqual({ kind: "s3", ref: "https://bucket.s3/raw/*.json" });
    expect(parseEngineSource("PostgreSQL", "PostgreSQL('pg:5432', 'crm', 'accounts', 'user', 'password')")).toEqual({ kind: "postgresql", ref: "pg:5432/crm/accounts" });
    expect(parseEngineSource("MergeTree", "MergeTree ORDER BY x")).toBeNull();
  });

  it("parses Distributed and Buffer destinations", () => {
    expect(parseDistributed("Distributed('prod', 'events', 'page_views_local', rand())", "events")).toEqual({ cluster: "prod", database: "events", table: "page_views_local" });
    expect(parseDistributed("Distributed(prod, currentDatabase(), t)", "x")).toEqual({ cluster: "prod", database: "x", table: "t" });
    expect(parseBuffer("Buffer('logs', 'app_errors', 16, 10, 100, 10000, 1000000, 10000000, 100000000)", "logs")).toEqual({ database: "logs", table: "app_errors" });
  });

  it("parses dictionary sources", () => {
    expect(parseDictionarySource("ClickHouse: shop.customers", "d")).toEqual({ kind: "table", database: "shop", table: "customers" });
    expect(parseDictionarySource("PostgreSQL: pg:5432/crm.accounts", "d")).toEqual({ kind: "postgresql", ref: "pg:5432/crm.accounts" });
  });

  it("parses unloaded dictionary sources from DDL", () => {
    expect(parseDictionaryCreate("CREATE DICTIONARY d.c (k String) PRIMARY KEY k SOURCE(CLICKHOUSE(DB 'shop' TABLE 'customers' USER 'default' PASSWORD '[HIDDEN]')) LIFETIME(300) LAYOUT(HASHED())", "d")).toEqual({ kind: "table", database: "shop", table: "customers" });
    expect(parseDictionaryCreate("CREATE DICTIONARY d.c (k String) PRIMARY KEY k SOURCE(POSTGRESQL(HOST 'pg' PORT 5432 DB 'crm' TABLE 'accounts' USER 'u' PASSWORD 'p')) LIFETIME(300) LAYOUT(HASHED())", "d")).toEqual({ kind: "postgresql", ref: "pg/crm/accounts" });
  });

  it("summarizeLocation drops credentials and query strings", () => {
    expect(summarizeLocation("https://a:b@host/x?sig=1")).toBe("https://host/x");
  });
});
