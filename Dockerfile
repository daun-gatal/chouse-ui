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

# Build server (optional - can run from source with Bun)
# RUN cd packages/server && bun run build

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

# Create non-root user for security
RUN addgroup -S ch-group -g 1001 && \
    adduser -S ch-user -u 1001 -G ch-group

# Set ownership
RUN chown -R ch-user:ch-group /app

# Add metadata labels
LABEL org.opencontainers.image.title="ClickHouse Studio" \
      org.opencontainers.image.description="A modern web interface for ClickHouse databases" \
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
    # ClickHouse connection settings (optional)
    # Default URL pre-filled in login form
    CLICKHOUSE_DEFAULT_URL="" \
    # Comma-separated list of preset URLs for dropdown
    CLICKHOUSE_PRESET_URLS="" \
    # Default username (optional, for convenience)
    CLICKHOUSE_DEFAULT_USER=""

# Expose port
EXPOSE 5521

# Switch to non-root user
USER ch-user

# Health check - verify both API and static serving work
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5521/api/health || exit 1

# Start the server
CMD ["bun", "run", "packages/server/src/index.ts"]
