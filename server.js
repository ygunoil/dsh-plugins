import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(fileURLToPath(new URL("./public/", import.meta.url)));
const engine = normalize(fileURLToPath(new URL("./lib/", import.meta.url)));
const engineFiles = new Set(["merge.js", "sources.js"]);
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
};

function resolvePath(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const parts = decoded.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part.includes("\0"))) return null;
  if (parts[0] === "engine" && parts.length === 2 && engineFiles.has(parts[1])) {
    return join(engine, parts[1]);
  }
  const base = root.endsWith(sep) ? root : root + sep;
  const file = parts.length ? normalize(join(root, ...parts)) : join(root, "index.html");
  if (file !== root && !file.startsWith(base)) return null;
  return file;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let file = resolvePath(url.pathname);
    if (!file) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("forbidden");
      return;
    }
    let info;
    try {
      info = await stat(file);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    if (info.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    response.end(body);
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DSH Plugins  http://127.0.0.1:${port}`);
});
