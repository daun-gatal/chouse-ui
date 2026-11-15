-- Fixture users and roles for the connection-identity e2e suite (ADR 0033 §5, §6).
--   svc_ceiling        an empty login: only roles, none of them default
--   svc_default_role   the same roles, left as default roles
--   svc_direct         holds one direct grant
--   svc_strong         holds a role that can create users
--   chouse_system      the system role: system tables, SHOW, KILL QUERY, no user table
--   analyst_ro         reads public
--   finance_rw         reads public, reads and writes secret
CREATE DATABASE IF NOT EXISTS public;
CREATE DATABASE IF NOT EXISTS secret;
CREATE TABLE IF NOT EXISTS public.events (id UInt32, name String) ENGINE = MergeTree ORDER BY id;
CREATE TABLE IF NOT EXISTS secret.salaries (id UInt32, amount UInt32) ENGINE = MergeTree ORDER BY id;
INSERT INTO public.events SELECT number, 'e' FROM numbers(10);
INSERT INTO secret.salaries SELECT number, 1000 FROM numbers(10);
CREATE ROLE IF NOT EXISTS chouse_system;
GRANT SELECT ON system.* TO chouse_system;
GRANT KILL QUERY ON *.* TO chouse_system;
GRANT SHOW ON *.* TO chouse_system;
CREATE ROLE IF NOT EXISTS analyst_ro;
GRANT SELECT ON public.* TO analyst_ro;
CREATE ROLE IF NOT EXISTS finance_rw;
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE, DROP TABLE ON secret.* TO finance_rw;
GRANT SELECT ON public.* TO finance_rw;
CREATE USER IF NOT EXISTS svc_ceiling IDENTIFIED BY 'e2e';
GRANT chouse_system, analyst_ro, finance_rw TO svc_ceiling;
ALTER USER svc_ceiling DEFAULT ROLE NONE;
CREATE USER IF NOT EXISTS svc_default_role IDENTIFIED BY 'e2e';
GRANT chouse_system, analyst_ro TO svc_default_role;
CREATE USER IF NOT EXISTS svc_direct IDENTIFIED BY 'e2e';
GRANT chouse_system TO svc_direct;
ALTER USER svc_direct DEFAULT ROLE NONE;
GRANT SELECT ON public.* TO svc_direct;
CREATE ROLE IF NOT EXISTS too_strong;
GRANT CREATE USER ON *.* TO too_strong;
CREATE USER IF NOT EXISTS svc_strong IDENTIFIED BY 'e2e';
GRANT chouse_system, too_strong TO svc_strong;
ALTER USER svc_strong DEFAULT ROLE NONE;
