import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { PlatformError } from "./errors";

export interface JsonFiles {
  read(path: string): Promise<unknown | null>;
  write(path: string, value: unknown): Promise<void>;
  backup(path: string, suffix: string): Promise<void>;
}
const hasCode = (error: unknown, code: string) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;
export const diskJsonFiles: JsonFiles = {
  async read(path) {
    try {
      if ((await stat(path)).size > 128 * 1024) throw new PlatformError("SCHEMA_MISMATCH");
      // Windows tools may emit a UTF-8 BOM. JSON.parse rejects it even though
      // it is a valid marker for a UTF-8 text file, so normalize it at the
      // storage boundary instead of reporting a healthy settings file as
      // schema corruption.
      const content = await readFile(path, "utf8");
      return JSON.parse(content.replace(/^\uFEFF/, ""));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      if (error instanceof SyntaxError) throw new PlatformError("SCHEMA_MISMATCH");
      throw error instanceof PlatformError ? error : new PlatformError("INTERNAL");
    }
  },
  async write(path, value) {
    const temporary = path + "." + randomUUID() + ".tmp";
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
    } catch {
      throw new PlatformError("INTERNAL");
    } finally {
      await unlink(temporary).catch(() => {});
    }
  },
  async backup(path, suffix) {
    try {
      await copyFile(path, path + suffix, constants.COPYFILE_EXCL);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw new PlatformError("INTERNAL");
    }
  },
};

export class SerialQueue {
  private pending: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work);
    this.pending = next.catch(() => {});
    return next;
  }
}
