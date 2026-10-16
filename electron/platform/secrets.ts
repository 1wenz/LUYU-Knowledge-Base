import { z } from "zod";
import {
  secretKindSchema,
  secretSetSchema,
  type SecretKind,
  type SecretSet,
  type SecretStatus,
} from "../../src/lib/contracts";
import { PlatformError } from "./errors";
import { diskJsonFiles, SerialQueue, type JsonFiles } from "./files";

export interface Encryption {
  isAvailable(): boolean;
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}
const ciphertextSchema = z
  .string()
  .min(1)
  .max(65536)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
const fileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  values: z.strictObject({
    "openrouter-api-key": ciphertextSchema.optional(),
    "cohere-api-key": ciphertextSchema.optional(),
    "database-password": ciphertextSchema.optional(),
  }),
});
export class SecretStore {
  private readonly session = new Map<SecretKind, string>();
  private readonly queue = new SerialQueue();
  private constructor(
    private readonly path: string,
    private encrypted: Partial<Record<SecretKind, string>>,
    private readonly encryption: Encryption,
    private readonly files: JsonFiles,
  ) {}
  static async open(
    path: string,
    encryption: Encryption,
    files: JsonFiles = diskJsonFiles,
  ): Promise<SecretStore> {
    const loaded = await files.read(path);
    if (loaded === null) return new SecretStore(path, {}, encryption, files);
    const result = fileSchema.safeParse(loaded);
    if (!result.success) throw new PlatformError("SCHEMA_MISMATCH");
    return new SecretStore(path, result.data.values, encryption, files);
  }
  status(): SecretStatus {
    const result = {} as SecretStatus;
    for (const kind of secretKindSchema.options) {
      const persistence = this.session.has(kind)
        ? "session"
        : this.encrypted[kind] && this.encryption.isAvailable()
          ? "encrypted"
          : "none";
      result[kind] = { configured: persistence !== "none", persistence };
    }
    return result;
  }
  async read(kind: SecretKind): Promise<string | null> {
    secretKindSchema.parse(kind);
    const memory = this.session.get(kind);
    if (memory !== undefined) return memory;
    const encrypted = this.encrypted[kind];
    if (!encrypted || !this.encryption.isAvailable()) return null;
    try {
      return this.encryption.decrypt(Buffer.from(encrypted, "base64"));
    } catch {
      throw new PlatformError("ENCRYPTION_UNAVAILABLE");
    }
  }
  set(input: SecretSet): Promise<SecretStatus> {
    return this.queue.run(async () => {
      const parsed = secretSetSchema.safeParse(input);
      if (!parsed.success) throw new PlatformError("INVALID_INPUT");
      const { kind, value, persistence } = parsed.data;
      const next = { ...this.encrypted };
      if (persistence === "encrypted") {
        if (!this.encryption.isAvailable()) throw new PlatformError("ENCRYPTION_UNAVAILABLE");
        try {
          next[kind] = Buffer.from(this.encryption.encrypt(value)).toString("base64");
        } catch {
          throw new PlatformError("ENCRYPTION_UNAVAILABLE");
        }
      } else {
        delete next[kind];
      }
      // A session replacement must first remove any old persisted credential, so it cannot reappear on restart.
      if (persistence === "encrypted" || this.encrypted[kind])
        await this.files.write(this.path, { schemaVersion: 1, values: next });
      this.encrypted = next;
      if (persistence === "session") this.session.set(kind, value);
      else this.session.delete(kind);
      return this.status();
    });
  }
  delete(kind: SecretKind): Promise<SecretStatus> {
    return this.queue.run(async () => {
      secretKindSchema.parse(kind);
      const next = { ...this.encrypted };
      delete next[kind];
      if (this.encrypted[kind])
        await this.files.write(this.path, { schemaVersion: 1, values: next });
      this.encrypted = next;
      this.session.delete(kind);
      return this.status();
    });
  }
  dispose(): void {
    this.session.clear();
  }
}
