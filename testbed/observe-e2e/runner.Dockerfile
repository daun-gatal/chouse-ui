# Runs the server-side observability e2e suites inside the testbed network
# (same dependency install as the production Dockerfile's build stage).
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/server/package.json ./packages/server/
RUN bun install --frozen-lockfile
COPY packages/server ./packages/server
WORKDIR /app/packages/server
CMD ["bun", "test", "--timeout", "600000", "src/services/observe/observe.e2e.test.ts", "src/services/observe/sources.e2e.test.ts"]
