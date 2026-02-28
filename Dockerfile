# Production Dockerfile for CHouse UI.
# Uses Bun for both building and running

# ============================================
# Build Stage
# ============================================
FROM oven/bun:1 AS build

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
FROM oven/bun:1-alpine AS production

# Install CA certificates for HTTPS connections and wget for healthcheck
RUN apk add --no-cache ca-certificates wget && update-ca-certificates

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

# Copy root package.json for workspace resolution (if needed)
COPY --from=build /app/package.json ./

# Install server production dependencies only
WORKDIR /app/packages/server
RUN bun install --production

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
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5521/api/health || exit 1

# Start the server
CMD ["bun", "run", "packages/server/src/index.ts"]
