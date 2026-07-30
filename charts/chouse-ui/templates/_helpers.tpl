{{/*
Expand the name of the chart.
*/}}
{{- define "chouse-ui.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name, truncated at 63 chars (DNS limit).
*/}}
{{- define "chouse-ui.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version for the chart label.
*/}}
{{- define "chouse-ui.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "chouse-ui.labels" -}}
helm.sh/chart: {{ include "chouse-ui.chart" . }}
{{ include "chouse-ui.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default (printf "v%s" .Chart.AppVersion) | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels (immutable — never add anything that changes across upgrades).
*/}}
{{- define "chouse-ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "chouse-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "chouse-ui.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "chouse-ui.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Full image reference. The release pipeline tags images v<semver>.
*/}}
{{- define "chouse-ui.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default (printf "v%s" .Chart.AppVersion)) }}
{{- end }}

{{/*
Name of the Secret holding JWT_SECRET / RBAC_ENCRYPTION_KEY / RBAC_ENCRYPTION_SALT.
*/}}
{{- define "chouse-ui.secretName" -}}
{{- .Values.secrets.existingSecret | default (printf "%s-secrets" (include "chouse-ui.fullname" .)) }}
{{- end }}

{{/*
Name of the Secret holding the PostgreSQL connection URL, and its key.
*/}}
{{- define "chouse-ui.postgresSecretName" -}}
{{- .Values.database.postgres.existingSecret | default (printf "%s-postgres" (include "chouse-ui.fullname" .)) }}
{{- end }}

{{- define "chouse-ui.postgresSecretKey" -}}
{{- if .Values.database.postgres.existingSecret }}
{{- .Values.database.postgres.existingSecretKey }}
{{- else }}
{{- "RBAC_POSTGRES_URL" }}
{{- end }}
{{- end }}

{{/*
Where the rendered config.yaml is mounted inside the container.
*/}}
{{- define "chouse-ui.configMountPath" -}}
/etc/chouse
{{- end }}

{{/*
Shared environment for every chouse-ui container (web and dedicated
scheduler). Scheduler enablement is per-workload, so it is NOT set here.
*/}}
{{- define "chouse-ui.env" -}}
- name: NODE_ENV
  value: production
- name: RBAC_DB_TYPE
  value: {{ .Values.database.type | quote }}
{{- if eq .Values.database.type "sqlite" }}
- name: RBAC_SQLITE_PATH
  value: /app/data/rbac.db
{{- else }}
- name: RBAC_POSTGRES_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "chouse-ui.postgresSecretName" . }}
      key: {{ include "chouse-ui.postgresSecretKey" . }}
- name: RBAC_POSTGRES_POOL_SIZE
  value: {{ .Values.database.postgres.poolSize | quote }}
{{- end }}
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "chouse-ui.secretName" . }}
      key: JWT_SECRET
- name: RBAC_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "chouse-ui.secretName" . }}
      key: RBAC_ENCRYPTION_KEY
- name: RBAC_ENCRYPTION_SALT
  valueFrom:
    secretKeyRef:
      name: {{ include "chouse-ui.secretName" . }}
      key: RBAC_ENCRYPTION_SALT
{{- if gt (int .Values.replicaCount) 1 }}
- name: CHOUSE_HA
  value: "true"
{{- end }}
{{- if .Values.config }}
- name: CHOUSE_CONFIG_PATH
  value: {{ include "chouse-ui.configMountPath" . }}/config.yaml
{{- end }}
{{- with .Values.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end }}
