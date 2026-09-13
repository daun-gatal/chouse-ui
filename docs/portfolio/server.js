import { serve } from "bun";
import { join } from "path";
import { existsSync, statSync } from "fs";

const PORT = parseInt(process.env.PORT || "3000");
const PUBLIC_DIR = "public";

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Remove leading slash
    if (pathname.startsWith("/")) {
      pathname = pathname.slice(1);
    }

    // Build candidate paths: exact file, then directory index (docs pages and
    // static directory URLs), then the SPA fallback.
    const candidates = [];
    if (pathname === "" || pathname === "/") {
      candidates.push("index.html");
    } else {
      candidates.push(pathname);
      candidates.push(
        pathname.endsWith("/") ? `${pathname}index.html` : `${pathname}/index.html`
      );
    }

    // Try to serve the requested file
    for (const candidate of candidates) {
      const filePath = join(PUBLIC_DIR, candidate);
      if (!existsSync(filePath)) continue;
      if (statSync(filePath).isDirectory()) continue;
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: {
          "Content-Type": getContentType(candidate),
        },
      });
    }

    // Fallback to index.html for SPA routing (React Router)
    const indexFile = Bun.file(join(PUBLIC_DIR, "index.html"));
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  },
});

function getContentType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const types = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    eot: "application/vnd.ms-fontobject",
    xml: "application/xml",
    txt: "text/plain",
    md: "text/markdown",
    webmanifest: "application/manifest+json",
  };
  return types[ext] || "application/octet-stream";
}

console.log(`🚀 Portfolio server running on port ${PORT}`);
console.log(`📁 Serving files from ${PUBLIC_DIR}/`);
