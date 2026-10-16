import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../out");
const port = Number(process.env.PORT ?? 3100);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    let target = resolve(root, "." + pathname);
    const relativePath = relative(root, target);
    if (
      relativePath === ".." ||
      relativePath.startsWith(".." + sep) ||
      relativePath.includes(":")
    ) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(target)).isDirectory()) target = resolve(target, "index.html");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(target)] ?? "application/octet-stream",
    });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log("预览：" + "http://127.0.0.1:" + port));
