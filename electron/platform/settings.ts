import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  publicSettingsSchema,
  settingsUpdateSchema,
  type PublicSettings,
  type SettingsUpdate,
} from "../../src/lib/contracts";
import { PlatformError } from "./errors";
import { diskJsonFiles, SerialQueue, type JsonFiles } from "./files";

const v0Schema = z.strictObject({
  schemaVersion: z.literal(0),
  settings: publicSettingsSchema.omit({ schemaVersion: true, revision: true }),
});
export function indexSettingsChanged(previous: PublicSettings, next: PublicSettings): boolean {
  return (
    previous.models.embeddingModel !== next.models.embeddingModel ||
    previous.models.embeddingDimensions !== next.models.embeddingDimensions ||
    previous.indexing.chunkTokens !== next.indexing.chunkTokens ||
    previous.indexing.overlapTokens !== next.indexing.overlapTokens
  );
}
export function databaseSettingsChanged(previous: PublicSettings, next: PublicSettings): boolean {
  return JSON.stringify(previous.database) !== JSON.stringify(next.database);
}
export class SettingsStore {
  private readonly queue = new SerialQueue();
  private reindex = false;
  private constructor(
    private readonly path: string,
    private value: PublicSettings,
    private readonly files: JsonFiles,
  ) {}
  static async open(path: string, files: JsonFiles = diskJsonFiles): Promise<SettingsStore> {
    const loaded = await files.read(path);
    if (loaded === null) return new SettingsStore(path, structuredClone(DEFAULT_SETTINGS), files);
    const current = publicSettingsSchema.safeParse(loaded);
    if (current.success) return new SettingsStore(path, current.data, files);
    const legacy = v0Schema.safeParse(loaded);
    if (!legacy.success) throw new PlatformError("SCHEMA_MISMATCH");
    const migrated = publicSettingsSchema.parse({
      ...legacy.data.settings,
      schemaVersion: 1,
      revision: 1,
    });
    await files.backup(path, ".v0.bak");
    await files.write(path, migrated);
    return new SettingsStore(path, migrated, files);
  }
  get(): PublicSettings {
    return structuredClone(this.value);
  }
  requiresReindex(): boolean {
    return this.reindex;
  }
  // The data service is authoritative after restart; this flag protects the current session before its status arrives.
  clearReindex(): void {
    this.reindex = false;
  }
  update(
    input: SettingsUpdate,
    apply?: (previous: PublicSettings, next: PublicSettings) => Promise<void>,
  ): Promise<PublicSettings> {
    return this.queue.run(async () => {
      const parsed = settingsUpdateSchema.safeParse(input);
      if (!parsed.success) throw new PlatformError("INVALID_INPUT");
      if (parsed.data.expectedRevision !== this.value.revision) throw new PlatformError("CONFLICT");
      const previous = this.get();
      const candidate = publicSettingsSchema.safeParse({
        ...previous,
        ...parsed.data.patch,
        revision: previous.revision + 1,
      });
      if (!candidate.success) throw new PlatformError("INVALID_INPUT");
      // Never mutate the snapshot before persistence succeeds. apply must close its old pool even if connection probing fails.
      await this.files.write(this.path, candidate.data);
      this.value = candidate.data;
      this.reindex ||= indexSettingsChanged(previous, candidate.data);
      if (apply) await apply(previous, this.get());
      return this.get();
    });
  }
}
