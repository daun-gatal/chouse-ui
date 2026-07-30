{{/*
Render-time validation. Included from deployment.yaml so every
template/install/upgrade path runs it. Broken topologies fail here, loudly,
instead of becoming silent duplicate jobs or per-pod databases at runtime.
*/}}
{{- define "chouse-ui.validate" -}}

{{- if not (has .Values.database.type (list "sqlite" "postgres")) }}
{{- fail (printf "database.type must be 'sqlite' or 'postgres', got '%s'" .Values.database.type) }}
{{- end }}

{{- if eq .Values.database.type "sqlite" }}
{{- if gt (int .Values.replicaCount) 1 }}
{{- fail (printf "replicaCount=%d with database.type=sqlite: SQLite cannot span pods — every replica would get its own database (separate users/settings) and every scheduler lease would be per-pod (duplicate scheduled runs and notifications). Set database.type=postgres for HA, or keep replicaCount=1." (int .Values.replicaCount)) }}
{{- end }}
{{- if .Values.autoscaling.enabled }}
{{- fail "autoscaling.enabled=true with database.type=sqlite: SQLite cannot span pods. Set database.type=postgres for HA." }}
{{- end }}
{{- if .Values.dedicatedScheduler.enabled }}
{{- fail "dedicatedScheduler.enabled=true with database.type=sqlite: the scheduler pod would get its own empty database and schedule nothing. Set database.type=postgres." }}
{{- end }}
{{- end }}

{{/* Secrets: match the server's own production validation so a bad value
     fails at render instead of as a CrashLoopBackOff. Only checked for the
     chart-managed Secret — an existingSecret's contents are the user's own. */}}
{{- if not .Values.secrets.existingSecret }}
{{- $gen := "Generate with: JWT_SECRET: openssl rand -base64 32 | RBAC_ENCRYPTION_KEY: openssl rand -hex 32 | RBAC_ENCRYPTION_SALT: openssl rand -hex 32" }}
{{- if and .Values.secrets.jwtSecret (lt (len .Values.secrets.jwtSecret) 32) }}
{{- fail (printf "secrets.jwtSecret must be at least 32 characters (got %d). %s" (len .Values.secrets.jwtSecret) $gen) }}
{{- end }}
{{- if and .Values.secrets.encryptionKey (lt (len .Values.secrets.encryptionKey) 32) }}
{{- fail (printf "secrets.encryptionKey must be at least 32 characters (got %d). %s" (len .Values.secrets.encryptionKey) $gen) }}
{{- end }}
{{- if and .Values.secrets.encryptionSalt (ne (len .Values.secrets.encryptionSalt) 64) }}
{{- fail (printf "secrets.encryptionSalt must be exactly 64 characters (got %d). %s" (len .Values.secrets.encryptionSalt) $gen) }}
{{- end }}
{{- end }}

{{/* Bundled evaluation databases (ADR 0009). Refuse the combinations that
     silently do nothing or set up two sources of truth. */}}
{{- if .Values.postgresql.enabled }}
{{- if ne .Values.database.type "postgres" }}
{{- fail (printf "postgresql.enabled=true with database.type=%s: the bundled PostgreSQL would run unused because the app would still store its data in SQLite. Set database.type=postgres, or disable postgresql." .Values.database.type) }}
{{- end }}
{{- if or .Values.database.postgres.url .Values.database.postgres.existingSecret }}
{{- fail "postgresql.enabled=true together with database.postgres.url/existingSecret: two sources of truth for the same connection. Use the bundled database for evaluation, or point at your own PostgreSQL — not both." }}
{{- end }}
{{- if not .Values.postgresql.auth.password }}
{{- fail "postgresql.auth.password is required when postgresql.enabled=true — the chart never invents credentials. Generate with: openssl rand -hex 16" }}
{{- end }}
{{- end }}
{{- if and .Values.clickhouse.enabled (not .Values.clickhouse.auth.password) }}
{{- fail "clickhouse.auth.password is required when clickhouse.enabled=true — the chart never invents credentials. Generate with: openssl rand -hex 16" }}
{{- end }}

{{/* config.yaml values override the pod environment (the server injects them
     into process.env last), so a config key the chart also manages would
     silently win over the chart's wiring. Refuse the ambiguity. */}}
{{- range $key := list "port" "node_env" "static_path" "chouse" "scheduled_queries" }}
{{- if hasKey $.Values.config $key }}
{{- fail (printf "config.%s conflicts with chart-managed settings — remove it from `config` and use the chart values instead (config.yaml overrides the pod environment)" $key) }}
{{- end }}
{{- end }}
{{- $rbac := .Values.config.rbac | default dict }}
{{- range $key := list "db_type" "sqlite_path" "postgres_url" "postgres_pool_size" "encryption" }}
{{- if hasKey $rbac $key }}
{{- fail (printf "config.rbac.%s conflicts with chart-managed settings — use the chart's `database`/`secrets` values instead (config.yaml overrides the pod environment)" $key) }}
{{- end }}
{{- end }}
{{- if hasKey (.Values.config.jwt | default dict) "secret" }}
{{- fail "config.jwt.secret conflicts with chart-managed settings — use secrets.jwtSecret or secrets.existingSecret instead (config.yaml overrides the pod environment)" }}
{{- end }}

{{- end }}
