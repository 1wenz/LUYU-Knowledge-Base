import { net, protocol } from "electron";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isWithin, resolveStaticPath } from "./security";

export const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'";
export function registerStaticProtocol(exportRoot: string): void {
  protocol.handle("knowledge", async (request) => {
    const resolved = resolveStaticPath(exportRoot, request.url, request.method);
    if (resolved.status !== 200 || !resolved.path)
      return new Response("Forbidden", { status: resolved.status });
    try {
      const candidate = (await stat(resolved.path)).isDirectory()
        ? join(resolved.path, "index.html")
        : resolved.path;
      const [root, path] = await Promise.all([realpath(exportRoot), realpath(candidate)]);
      if (!isWithin(root, path)) return new Response("Forbidden", { status: 403 });
      if (!(await stat(path)).isFile()) return new Response("Not found", { status: 404 });
      const response = await net.fetch(pathToFileURL(path).href);
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", PRODUCTION_CSP);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      return new Response(request.method === "HEAD" ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
