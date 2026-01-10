import { serve } from "bun";
import { join } from "path";
import { existsSync } from "fs";

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
    
    // Default to index.html
    if (pathname === "" || pathname === "/") {
      pathname = "index.html";
    }
    
    // Try to serve the requested file
    const filePath = join(PUBLIC_DIR, pathname);
    if (existsSync(filePath)) {
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: {
          "Content-Type": getContentType(pathname),
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
  };
  return types[ext] || "application/octet-stream";
}

console.log(`🚀 Portfolio server running on port ${PORT}`);
console.log(`📁 Serving files from ${PUBLIC_DIR}/`);
