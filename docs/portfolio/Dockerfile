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

# Create a simple server script using Bun's built-in file serving
RUN echo 'import { serve } from "bun";\nimport { join } from "path";\nimport { existsSync } from "fs";\n\nconst PORT = parseInt(process.env.PORT || "3000");\nconst PUBLIC_DIR = "public";\n\nserve({\n  port: PORT,\n  async fetch(req) {\n    const url = new URL(req.url);\n    let pathname = url.pathname;\n    \n    // Remove leading slash\n    if (pathname.startsWith("/")) {\n      pathname = pathname.slice(1);\n    }\n    \n    // Default to index.html\n    if (pathname === "" || pathname === "/") {\n      pathname = "index.html";\n    }\n    \n    // Try to serve the requested file\n    const filePath = join(PUBLIC_DIR, pathname);\n    if (existsSync(filePath)) {\n      const file = Bun.file(filePath);\n      return new Response(file, {\n        headers: {\n          "Content-Type": getContentType(pathname),\n        },\n      });\n    }\n    \n    // Fallback to index.html for SPA routing (React Router)\n    const indexFile = Bun.file(join(PUBLIC_DIR, "index.html"));\n    return new Response(indexFile, {\n      headers: {\n        "Content-Type": "text/html",\n      },\n    });\n  },\n});\n\nfunction getContentType(filename) {\n  const ext = filename.split(".").pop()?.toLowerCase();\n  const types = {\n    html: "text/html",\n    css: "text/css",\n    js: "application/javascript",\n    json: "application/json",\n    png: "image/png",\n    jpg: "image/jpeg",\n    jpeg: "image/jpeg",\n    gif: "image/gif",\n    svg: "image/svg+xml",\n    ico: "image/x-icon",\n    woff: "font/woff",\n    woff2: "font/woff2",\n    ttf: "font/ttf",\n    eot: "application/vnd.ms-fontobject",\n  };\n  return types[ext] || "application/octet-stream";\n}\n\nconsole.log(`🚀 Portfolio server running on port ${PORT}`);\nconsole.log(`📁 Serving files from ${PUBLIC_DIR}/`);' > server.js

# Expose port
EXPOSE 3000

# Start the server
CMD ["bun", "run", "server.js"]
