-- Sample data, users and roles for the connection-identity lab (ADR 0033).
-- The same file runs on both ClickHouse servers, so every connection kind can
-- be tried on either one.
--
--   Data
--     shop.orders, shop.customers      what an analyst reads
--     finance.invoices, finance.salaries   what only finance reads
--
--   Logins for CHouse UI itself
--     default / lab          a shared login: holds every grant
--     svc_ceiling / lab      empty; roles chouse_system, analyst_ro, finance_rw
--     svc_personal / lab     empty; roles chouse_system, chouse_impersonate
--
--   People's own ClickHouse users (password lab)
--     alice   reads shop
--     bob     reads shop; reads and writes finance
--     carol   can create users, so CHouse UI refuses to link her
--     dave    reads shop; the impersonation role has no grant on him yet
CREATE DATABASE IF NOT EXISTS shop;
CREATE DATABASE IF NOT EXISTS finance;
CREATE TABLE IF NOT EXISTS shop.customers (id UInt32, name String, country LowCardinality(String), signed_up Date) ENGINE = MergeTree ORDER BY id;
CREATE TABLE IF NOT EXISTS shop.orders (id UInt64, customer_id UInt32, placed_at DateTime, status LowCardinality(String), amount Decimal(10, 2)) ENGINE = MergeTree ORDER BY (placed_at, id);
CREATE TABLE IF NOT EXISTS finance.invoices (id UInt64, order_id UInt64, issued_on Date, total Decimal(10, 2), paid UInt8) ENGINE = MergeTree ORDER BY id;
CREATE TABLE IF NOT EXISTS finance.salaries (employee String, team LowCardinality(String), monthly UInt32) ENGINE = MergeTree ORDER BY employee;
CREATE TABLE IF NOT EXISTS finance.imports (id UInt32, name String) ENGINE = MergeTree ORDER BY id;
INSERT INTO shop.customers SELECT number + 1, concat('Customer ', toString(number + 1)), ['DE', 'FR', 'ID', 'US', 'JP'][number % 5 + 1], toDate('2024-01-01') + number % 600 FROM numbers(2000) WHERE (SELECT count() FROM shop.customers) = 0;
INSERT INTO shop.orders SELECT number + 1, number % 2000 + 1, now() - toIntervalMinute(number * 7), ['paid', 'paid', 'paid', 'shipped', 'refunded'][number % 5 + 1], toDecimal64(10 + (number * 37) % 490, 2) FROM numbers(50000) WHERE (SELECT count() FROM shop.orders) = 0;
INSERT INTO finance.invoices SELECT number + 1, number + 1, today() - number % 365, toDecimal64(10 + (number * 37) % 490, 2), number % 7 != 0 FROM numbers(20000) WHERE (SELECT count() FROM finance.invoices) = 0;
INSERT INTO finance.salaries SELECT concat('employee_', toString(number + 1)), ['data', 'finance', 'platform', 'sales'][number % 4 + 1], 3000 + (number * 113) % 6000 FROM numbers(40) WHERE (SELECT count() FROM finance.salaries) = 0;

CREATE ROLE IF NOT EXISTS chouse_system;
GRANT SELECT ON system.* TO chouse_system;
GRANT SHOW ON *.* TO chouse_system;
GRANT KILL QUERY ON *.* TO chouse_system;
CREATE ROLE IF NOT EXISTS analyst_ro;
GRANT SELECT ON shop.* TO analyst_ro;
GRANT SELECT ON system.* TO analyst_ro;
CREATE ROLE IF NOT EXISTS finance_rw;
GRANT SELECT ON shop.* TO finance_rw;
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE, DROP TABLE ON finance.* TO finance_rw;
GRANT SELECT ON system.* TO finance_rw;
CREATE USER IF NOT EXISTS svc_ceiling IDENTIFIED BY 'lab';
GRANT chouse_system, analyst_ro, finance_rw TO svc_ceiling;
ALTER USER svc_ceiling DEFAULT ROLE NONE;

CREATE USER IF NOT EXISTS alice IDENTIFIED BY 'lab';
GRANT SELECT ON shop.* TO alice;
CREATE USER IF NOT EXISTS bob IDENTIFIED BY 'lab';
GRANT SELECT ON shop.* TO bob;
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE, DROP TABLE ON finance.* TO bob;
CREATE USER IF NOT EXISTS carol IDENTIFIED BY 'lab';
GRANT SELECT ON shop.* TO carol;
GRANT CREATE USER ON *.* TO carol;
CREATE USER IF NOT EXISTS dave IDENTIFIED BY 'lab';
GRANT SELECT ON shop.* TO dave;

CREATE ROLE IF NOT EXISTS chouse_impersonate;
CREATE USER IF NOT EXISTS svc_personal IDENTIFIED BY 'lab';
GRANT IMPERSONATE ON svc_personal TO chouse_impersonate;
GRANT IMPERSONATE ON alice TO chouse_impersonate;
GRANT IMPERSONATE ON bob TO chouse_impersonate;
GRANT IMPERSONATE ON carol TO chouse_impersonate;
GRANT chouse_system, chouse_impersonate TO svc_personal;
ALTER USER svc_personal DEFAULT ROLE NONE;
-- The last statement: the health check waits for this user.
CREATE USER IF NOT EXISTS lab_ready IDENTIFIED BY 'lab';
