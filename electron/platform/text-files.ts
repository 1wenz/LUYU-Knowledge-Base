import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
import { LIMITS, type PickedTextFiles } from "../../src/lib/contracts";
import { PlatformError } from "./errors";

// Called only with paths returned by the main-process native chooser, never an IPC path argument.
export async function readPickedTextFiles(paths: string[]): Promise<PickedTextFiles> {
  if (paths.length > LIMITS.importCount) throw new PlatformError("INVALID_INPUT");
  const files: PickedTextFiles["files"] = [];
  let total = 0;
  for (const path of paths) {
    if (![".md", ".markdown", ".txt"].includes(extname(path).toLowerCase()))
      throw new PlatformError("INVALID_INPUT");
    try {
      const file = await open(path, "r");
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > LIMITS.documentBytes)
          throw new PlatformError("INVALID_INPUT");
        const buffer = Buffer.alloc(LIMITS.documentBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        total += length;
        if (length > LIMITS.documentBytes || total > LIMITS.importBytes)
          throw new PlatformError("INVALID_INPUT");
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length),
        );
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content))
          throw new PlatformError("INVALID_INPUT");
        files.push({ name: basename(path), content });
      } finally {
        await file.close();
      }
    } catch (error) {
      throw error instanceof PlatformError ? error : new PlatformError("INVALID_INPUT");
    }
  }
  return { files };
}
