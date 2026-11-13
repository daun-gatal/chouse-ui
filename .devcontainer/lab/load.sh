#!/bin/sh
# Light, steady query load for the lab, so Monitoring, Fleet, query history and
# data freshness have something real to show. Runs in the `load` service of
# compose.yml and talks to ClickHouse directly with clickhouse-client.
#
# One tick every 5 seconds:
#   - every tick: one cheap dashboard-style query
#   - every 30 s: a small batch of new orders (keeps tables fresh)
#   - every 2 min: one deliberately slow query to investigate (full scan on a
#     column that is not in the sort key, single-threaded)
#   - every 10 min: one query that fails (unknown column), for the error views
#
# Every query carries a log_comment starting with "lab:" so it is easy to find
# in system.query_log and in CHouse UI.
set -u

ch() {
  comment="$1"
  shift
  clickhouse-client --host clickhouse --user admin --password "$CLICKHOUSE_PASSWORD" \
    --log_comment="$comment" --max_execution_time=60 --query "$1" >/dev/null 2>&1
}

QUERIES_COUNT=4

cheap_query() {
  case "$1" in
    0) ch lab:load "SELECT country, count() AS orders, sum(amount) AS revenue FROM shop.orders_raw WHERE created_at >= now() - INTERVAL 1 DAY GROUP BY country ORDER BY revenue DESC" ;;
    1) ch lab:load "SELECT day, sum(orders) AS orders, sum(revenue) AS revenue FROM analytics.orders_daily WHERE day >= today() - 7 GROUP BY day ORDER BY day" ;;
    2) ch lab:load "SELECT toStartOfHour(created_at) AS hour, count() FROM shop.orders_raw WHERE created_at >= now() - INTERVAL 6 HOUR GROUP BY hour ORDER BY hour" ;;
    *) ch lab:load "SELECT c.country, uniqExact(o.customer_id) AS buyers FROM shop.orders_raw AS o INNER JOIN shop.customers AS c ON o.customer_id = c.customer_id WHERE o.created_at >= now() - INTERVAL 2 HOUR GROUP BY c.country" ;;
  esac
}

tick=0
while true; do
  cheap_query $((tick % QUERIES_COUNT))

  if [ $((tick % 6)) -eq 0 ]; then
    ch lab:ingest "INSERT INTO shop.orders_raw SELECT toUInt64(toUnixTimestamp64Milli(now64(3))) * 1000 + number, rand() % 50000, toDecimal64((rand() % 20000) / 100, 2), 'EUR', ['DE', 'FR', 'NL', 'US', 'ID', 'JP'][rand() % 6 + 1], now() FROM numbers(500)"
  fi

  if [ $((tick % 24)) -eq 0 ]; then
    ch lab:slow-query "SELECT customer_id, count() AS orders, sum(amount) AS spent FROM shop.orders_raw WHERE lower(currency) = 'eur' AND toString(customer_id) LIKE '%42%' GROUP BY customer_id ORDER BY spent DESC LIMIT 20 SETTINGS max_threads = 1"
  fi

  if [ $((tick % 120)) -eq 60 ]; then
    ch lab:broken-query "SELECT order_total FROM shop.orders_raw LIMIT 1"
  fi

  tick=$((tick + 1))
  sleep 5
done
