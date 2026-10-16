import { isAbsolute, relative, resolve, sep } from "node:path";
import { PlatformError } from "./errors";

export const PRODUCTION_ORIGIN = "knowledge://app";
export function trustedOrigin(address: string, expected: string): boolean {
  try {
    const candidate = new URL(address);
    const target = new URL(expected);
    return (
      !candidate.username &&
      !candidate.password &&
      candidate.protocol === target.protocol &&
      candidate.host === target.host
    );
  } catch {
    return false;
  }
}
export function rendererOrigin(packaged: boolean, developmentAddress?: string): string {
  if (packaged || !developmentAddress) return PRODUCTION_ORIGIN;
  const address = new URL(developmentAddress);
  if (
    address.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ||
    address.username ||
    address.password ||
    address.pathname !== "/" ||
    address.search ||
    address.hash
  )
    throw new PlatformError("INVALID_INPUT");
  return address.origin;
}
export function isWithin(root: string, target: string): boolean {
  const offset = relative(root, target);
  return (
    offset !== ".." &&
    !offset.startsWith(".." + sep) &&
    !isAbsolute(offset) &&
    !offset.includes(":")
  );
}
export function resolveStaticPath(
  root: string,
  address: string,
  method: string,
): { status: number; path?: string } {
  try {
    const url = new URL(address);
    if (
      url.protocol !== "knowledge:" ||
      url.host !== "app" ||
      url.username ||
      url.password ||
      !["GET", "HEAD"].includes(method)
    )
      return { status: 403 };
    // Inspect the original path before URL dot-segment normalization, including encoded and Windows paths.
    const raw = address.replace(/^[^:]+:\/\/[^/?#]*/, "").split(/[?#]/, 1)[0] || "/";
    const path = decodeURIComponent(raw);
    if (
      !path.startsWith("/") ||
      /[\\\0:%]/.test(path) ||
      path
        .split("/")
        .some(
          (part) =>
            part === "." ||
            part === ".." ||
            /[. ]$/.test(part) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      return { status: 403 };
    const target = resolve(root, "." + path, ...(path.endsWith("/") ? ["index.html"] : []));
    return isWithin(root, target) ? { status: 200, path: target } : { status: 403 };
  } catch {
    return { status: 400 };
  }
}
export function validateExternalUrl(input: string): string {
  if (input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input))
    throw new PlatformError("INVALID_INPUT");
  try {
    const url = new URL(input);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw new Error();
    return url.href;
  } catch {
    throw new PlatformError("INVALID_INPUT");
  }
}
