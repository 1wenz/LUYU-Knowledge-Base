import {
  collectionSchema,
  documentSchema,
  LIMITS,
  type Collection,
  type Document,
} from "../contracts";

// This is a versioned disk format, not an additional IPC interface.
export type BackupCollection = Collection;
export type BackupDocument = Document;
export type BackupSnapshot = { collections: BackupCollection[]; documents: BackupDocument[] };
export type BackupEnvelope = {
  format: "zhiyu-knowledge-backup";
  version: 1;
  appVersion: string;
  exportedAt: string;
  payload: BackupSnapshot;
  integrity: { algorithm: "SHA-256"; digest: string };
};
export type BackupErrorCode =
  | "INVALID_JSON"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "LIMIT_EXCEEDED"
  | "DUPLICATE_ID"
  | "INVALID_REFERENCE"
  | "INTEGRITY_MISMATCH";

export class BackupError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

export const backupLimits = {
  maxFileBytes: 32 * 1024 * 1024,
  maxDocumentBytes: LIMITS.documentBytes,
  maxDocuments: 10_000,
  maxCollections: 1_000,
} as const;

const collectionKeys = ["id", "name", "sortOrder"] as const;
const documentKeys = [
  "id",
  "collectionId",
  "title",
  "contentMarkdown",
  "tags",
  "favorite",
  "revision",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function invalid(message = "备份数据格式无效。"): never {
  throw new BackupError("INVALID_FORMAT", message);
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  if (Object.keys(value).some((key) => forbiddenKeys.has(key))) invalid();
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !own(value, key))) invalid();
}

function assertString(value: unknown, maxLength: number): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\u0000")
  )
    invalid();
}

function assertExportTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    invalid();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) invalid();
}

function assertByteLength(value: string, limit: number) {
  if (value.length > limit || new TextEncoder().encode(value).byteLength > limit) {
    throw new BackupError("LIMIT_EXCEEDED", "备份内容超过大小限制。");
  }
}

function readItem<T extends object>(
  input: unknown,
  keys: readonly string[],
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  strict: boolean,
): T {
  assertRecord(input);
  if (strict) assertExactKeys(input, keys);
  if (keys.some((key) => !own(input, key))) invalid();
  const projected = Object.fromEntries(keys.map((key) => [key, input[key]]));
  const parsed = schema.safeParse(projected);
  if (!parsed.success) invalid();
  // An archive must not silently trim titles/tags or remove duplicate tags.
  const canonical = parsed.data as Record<string, unknown>;
  if (keys.some((key) => JSON.stringify(projected[key]) !== JSON.stringify(canonical[key])))
    invalid();
  return parsed.data;
}

function normalizeSnapshot(input: unknown, strict: boolean): BackupSnapshot {
  assertRecord(input);
  if (strict) assertExactKeys(input, ["collections", "documents"]);
  if (!Array.isArray(input.collections) || !Array.isArray(input.documents)) invalid();
  if (
    input.collections.length > backupLimits.maxCollections ||
    input.documents.length > backupLimits.maxDocuments
  ) {
    throw new BackupError("LIMIT_EXCEEDED", "备份条目数量超过限制。");
  }

  let payloadBytes = 0;
  const countItemBytes = (item: Collection | Document) => {
    payloadBytes += new TextEncoder().encode(JSON.stringify(item)).byteLength + 1;
    if (payloadBytes > backupLimits.maxFileBytes) {
      throw new BackupError("LIMIT_EXCEEDED", "备份内容超过大小限制。");
    }
  };
  const collectionIds = new Set<string>();
  const collections = input.collections.map((value) => {
    const collection = readItem(value, collectionKeys, collectionSchema, strict);
    const key = collection.id.toLowerCase();
    if (collectionIds.has(key)) throw new BackupError("DUPLICATE_ID", "分类标识重复。");
    collectionIds.add(key);
    countItemBytes(collection);
    return collection;
  });
  const documentIds = new Set<string>();
  const documents = input.documents.map((value: unknown) => {
    assertRecord(value);
    if (typeof value.contentMarkdown === "string")
      assertByteLength(value.contentMarkdown, backupLimits.maxDocumentBytes);
    const document = readItem(value, documentKeys, documentSchema, strict);
    const key = document.id.toLowerCase();
    if (documentIds.has(key)) throw new BackupError("DUPLICATE_ID", "文档标识重复。");
    documentIds.add(key);
    if (document.collectionId !== null && !collectionIds.has(document.collectionId.toLowerCase())) {
      throw new BackupError("INVALID_REFERENCE", "文档引用了不存在的分类。");
    }
    countItemBytes(document);
    return document;
  });
  const compareIds = (left: { id: string }, right: { id: string }) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  collections.sort(compareIds);
  documents.sort(compareIds);
  return { collections, documents };
}

function coreValue(envelope: Omit<BackupEnvelope, "integrity">) {
  return {
    format: envelope.format,
    version: envelope.version,
    appVersion: envelope.appVersion,
    exportedAt: envelope.exportedAt,
    payload: envelope.payload,
  };
}

async function sha256Hex(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Validate and copy canonical DTOs for a disk export, excluding internal fields. */
export function prepareBackupSnapshot(input: unknown): BackupSnapshot {
  return normalizeSnapshot(input, false);
}

export async function createBackup(
  snapshot: BackupSnapshot,
  options: { appVersion: string; exportedAt?: string },
): Promise<string> {
  assertRecord(options);
  assertString(options.appVersion, 64);
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  assertExportTimestamp(exportedAt);
  const payload = prepareBackupSnapshot(snapshot);
  const core = coreValue({
    format: "zhiyu-knowledge-backup",
    version: 1,
    appVersion: options.appVersion,
    exportedAt,
    payload,
  });
  const serialized = JSON.stringify(core);
  assertByteLength(serialized, backupLimits.maxFileBytes);
  const integrity = { algorithm: "SHA-256" as const, digest: await sha256Hex(serialized) };
  const text = JSON.stringify({ ...core, integrity });
  assertByteLength(text, backupLimits.maxFileBytes);
  return text;
}

function parseEnvelope(value: unknown): BackupEnvelope {
  assertRecord(value);
  assertExactKeys(value, ["format", "version", "appVersion", "exportedAt", "payload", "integrity"]);
  if (value.format !== "zhiyu-knowledge-backup") invalid("备份格式不受支持。");
  if (
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  )
    invalid();
  if (value.version !== 1) throw new BackupError("UNSUPPORTED_VERSION", "备份版本不受支持。");
  assertString(value.appVersion, 64);
  assertExportTimestamp(value.exportedAt);
  const payload = normalizeSnapshot(value.payload, true);
  assertRecord(value.integrity);
  assertExactKeys(value.integrity, ["algorithm", "digest"]);
  if (
    value.integrity.algorithm !== "SHA-256" ||
    typeof value.integrity.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.integrity.digest)
  ) {
    invalid("备份完整性摘要无效。");
  }
  return {
    format: "zhiyu-knowledge-backup",
    version: 1,
    appVersion: value.appVersion,
    exportedAt: value.exportedAt,
    payload,
    integrity: { algorithm: "SHA-256", digest: value.integrity.digest },
  };
}

export async function readBackup(text: string): Promise<BackupEnvelope> {
  if (typeof text !== "string") throw new BackupError("INVALID_JSON", "备份文件不是文本。");
  assertByteLength(text, backupLimits.maxFileBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("INVALID_JSON", "备份文件不是有效的 JSON。");
  }
  const envelope = parseEnvelope(parsed);
  const expected = await sha256Hex(JSON.stringify(coreValue(envelope)));
  if (expected !== envelope.integrity.digest)
    throw new BackupError("INTEGRITY_MISMATCH", "备份完整性校验失败。");
  return envelope;
}
