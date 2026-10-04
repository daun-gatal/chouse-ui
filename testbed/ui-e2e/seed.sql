CREATE DATABASE IF NOT EXISTS shop;
CREATE TABLE IF NOT EXISTS shop.orders_raw (order_id UInt64, customer_id UInt64, amount Decimal(18, 2), currency LowCardinality(String), country LowCardinality(String), created_at DateTime) ENGINE = MergeTree PARTITION BY toYYYYMM(created_at) ORDER BY (created_at, order_id);
CREATE TABLE IF NOT EXISTS shop.customers (customer_id UInt64, name String, country LowCardinality(String), updated_at DateTime) ENGINE = ReplacingMergeTree(updated_at) ORDER BY customer_id;
CREATE DATABASE IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.orders_daily (day Date, country LowCardinality(String), orders UInt64, revenue Decimal(38, 2)) ENGINE = SummingMergeTree ORDER BY (day, country);
CREATE MATERIALIZED VIEW IF NOT EXISTS shop.mv_orders_agg TO analytics.orders_daily AS SELECT toDate(created_at) AS day, country, count() AS orders, sum(amount) AS revenue FROM shop.orders_raw GROUP BY day, country;
INSERT INTO shop.customers SELECT number, concat('customer-', toString(number)), ['DE', 'FR', 'NL', 'US'][number % 4 + 1], toDateTime('2026-09-01 00:00:00') FROM numbers(200);
INSERT INTO shop.orders_raw SELECT number, number % 200, toDecimal64((number % 97) + 0.5, 2), 'EUR', ['DE', 'FR', 'NL', 'US'][number % 4 + 1], toDateTime('2026-09-01 00:00:00') + number * 60 FROM numbers(5000);
