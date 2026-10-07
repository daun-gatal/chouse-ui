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

# Install the server's production dependencies from the lockfile, so the image
# runs exactly the versions CI tested and a package published minutes ago (still
# 404 on npm's CDN) can never break the build. `--filter` limits the install to
# the server workspace: the frontend's runtime dependencies (~735 MB) are never
# loaded — the frontend is served as the pre-built bundle in /app/dist — and stay
# off the vulnerability scanners' radar. The root manifest and lockfile are
# removed afterwards; only the install needs them.
# Bun's global install cache holds the *whole* dependency tree, dev included
# (~1 GB of prebuilt binaries such as old esbuild releases). It is build-time
# scratch, so drop it in the same layer — otherwise it ships in the image and gets
# scanned as if it were part of the runtime.
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --production --frozen-lockfile --filter '@chouseui/server' && \
    rm -rf /root/.bun/install/cache package.json bun.lock

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

# Web, API and the MCP endpoint (/mcp, turned on in Agents › MCP) share one port
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
