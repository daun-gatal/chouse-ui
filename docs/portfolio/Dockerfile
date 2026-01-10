# Multi-stage build for Portfolio Site
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Build the application (outputs to ../dist relative to /app, which is /dist)
RUN bun run build

# Production stage - simple static file server with Bun
FROM oven/bun:1-alpine

WORKDIR /app

# Copy built files from builder
COPY --from=builder /dist ./public

# Copy server script
COPY server.js ./server.js

# Expose port
EXPOSE 3000

# Start the server
CMD ["bun", "run", "server.js"]
