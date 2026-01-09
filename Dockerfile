# Production Dockerfile for ClickHouse Studio
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
LABEL org.opencontainers.image.title="ClickHouse Studio" \
      org.opencontainers.image.description="A modern web interface for ClickHouse databases with RBAC" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/daun-gatal/clickhouse-studio"

# Environment variables with sensible defaults
ENV NODE_ENV=production \
    PORT=5521 \
    STATIC_PATH=/app/dist \
    # Session configuration
    SESSION_TTL=3600000 \
    # CORS settings - override with your domain in production
    # Example: CORS_ORIGIN=https://your-domain.com
    CORS_ORIGIN=* \
    # ============================================
    # RBAC Configuration
    # ============================================
    # Database type: 'sqlite' (default) or 'postgres'
    RBAC_DB_TYPE=sqlite \
    # SQLite database path (used when RBAC_DB_TYPE=sqlite)
    RBAC_SQLITE_PATH=/app/data/rbac.db \
    # PostgreSQL connection URL (used when RBAC_DB_TYPE=postgres)
    # Example: postgres://user:password@host:5432/dbname
    RBAC_POSTGRES_URL="" \
    # PostgreSQL connection pool size
    RBAC_POSTGRES_POOL_SIZE=10 \
    # JWT secret for RBAC authentication (CHANGE IN PRODUCTION!)
    # Generate with: openssl rand -base64 32
    JWT_SECRET=change-me-in-production-use-openssl-rand-base64-32 \
    # JWT access token expiry (default: 15 minutes)
    JWT_ACCESS_EXPIRY=15m \
    # JWT refresh token expiry (default: 7 days)
    JWT_REFRESH_EXPIRY=7d \
    # Encryption key for ClickHouse connection passwords (CHANGE IN PRODUCTION!)
    # Generate with: openssl rand -hex 32
    RBAC_ENCRYPTION_KEY=change-me-in-production-use-openssl-rand-hex-32 \
    # Default admin password (only used on first run)
    # IMPORTANT: Change this or set a strong password via environment
    RBAC_ADMIN_PASSWORD="" \
    # ============================================
    # Legacy ClickHouse settings (optional)
    # ============================================
    # Default URL pre-filled in login form (deprecated - use RBAC connections)
    CLICKHOUSE_DEFAULT_URL="" \
    # Comma-separated list of preset URLs for dropdown (deprecated)
    CLICKHOUSE_PRESET_URLS="" \
    # Default username (deprecated)
    CLICKHOUSE_DEFAULT_USER=""

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
