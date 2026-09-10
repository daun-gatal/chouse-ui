# Production Dockerfile for CHouse UI.
# Uses Bun for both building and running.

# ============================================
# Build Stage
# ============================================
# Base images are digest-pinned for reproducible scans; Renovate bumps them.
FROM oven/bun:1@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS build

# Build arguments
ARG VERSION=dev
ARG COMMIT_SHA=unknown
ARG BUILD_DATE=unknown

WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lock ./
COPY packages/server/package.json ./packages/server/

# Install all dependencies (including dev for build)
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Build frontend
RUN bun run build:web

# ============================================
# Production Stage
# ============================================
# Base images are digest-pinned for reproducible scans; Renovate bumps them.
FROM oven/bun:1-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS production

# Patch base-image packages (the upstream tag lags Alpine security updates) and
# install CA certificates for HTTPS connections.
# The HEALTHCHECK uses busybox's built-in wget, so GNU wget is deliberately not
# installed — it ships unfixed CVEs and adds nothing busybox doesn't cover.
# libcrypto3/libssl3 carry an explicit floor so a base that predates the OpenSSL
# security bump fails the build instead of silently shipping known CVEs.
RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0' && \
    update-ca-certificates

# Re-declare build arguments for labels
ARG VERSION=dev
ARG COMMIT_SHA=unknown
ARG BUILD_DATE=unknown

WORKDIR /app

# Copy built frontend assets
COPY --from=build /app/dist ./dist

# Copy server package and dependencies
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/server/src ./packages/server/src
COPY --from=build /app/packages/server/tsconfig.json ./packages/server/

# The root package.json is deliberately NOT copied. Its presence makes Bun treat
# /app as a workspace root and also install the *frontend's* runtime dependencies
# (~735 MB) — which the runtime never loads, because the frontend is served as the
# pre-built static bundle in /app/dist. Leaving it out keeps the install to the
# server's own 227 packages and off the vulnerability scanners' radar.

# Install server production dependencies only.
# Bun's global install cache is populated during resolution and holds the *whole*
# dependency tree, dev included (~1 GB of prebuilt binaries such as old esbuild
# releases). It is build-time scratch, so drop it in the same layer — otherwise it
# ships in the image and gets scanned as if it were part of the runtime.
WORKDIR /app/packages/server
RUN bun install --production && \
    rm -rf /root/.bun/install/cache

# Back to app root
WORKDIR /app

# Create data directory for RBAC SQLite database
RUN mkdir -p /app/data

# Create non-root user for security
RUN addgroup -S ch-group -g 1001 && \
    adduser -S ch-user -u 1001 -G ch-group

# Set ownership (including data directory)
RUN chown -R ch-user:ch-group /app

# Add metadata labels
LABEL org.opencontainers.image.title="CHouse UI" \
      org.opencontainers.image.description="A modern web interface for ClickHouse databases with RBAC" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/daun-gatal/chouse-ui"

# Environment variables with sensible defaults
# NOTE: Sensitive values (JWT_SECRET, RBAC_ENCRYPTION_KEY, RBAC_ADMIN_PASSWORD)
# should be set at runtime via docker run -e or docker-compose, not in Dockerfile
ENV NODE_ENV=production \
    PORT=5521 \
    STATIC_PATH=/app/dist \
    SESSION_TTL=3600000 \
    CORS_ORIGIN=* \
    CHOUSE_CONFIG_PATH="" \
    RBAC_DB_TYPE=sqlite \
    RBAC_SQLITE_PATH=/app/data/rbac.db \
    RBAC_POSTGRES_URL="" \
    RBAC_POSTGRES_POOL_SIZE=10 \
    JWT_ACCESS_EXPIRY=4h \
    JWT_REFRESH_EXPIRY=7d \
    CLICKHOUSE_DEFAULT_URL="" \
    CLICKHOUSE_PRESET_URLS="" \
    CLICKHOUSE_DEFAULT_USER="" \
    AI_OPTIMIZER_ENABLED=false \
    AI_PROVIDER=openai \
    AI_API_KEY="" \
    AI_MODEL_NAME="" \
    AI_BASE_URL=""

# Volume for persistent RBAC data (SQLite database)
VOLUME ["/app/data"]

# Expose port
EXPOSE 5521

# Switch to non-root user
USER ch-user

# Health check - verify both API and static serving work
# Flags are busybox-wget compatible (no --no-verbose/--tries); -T caps the request
# so a hung server fails the check instead of stalling it.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q -T 5 --spider http://localhost:5521/api/health || exit 1

# Start the server
CMD ["bun", "run", "packages/server/src/index.ts"]
