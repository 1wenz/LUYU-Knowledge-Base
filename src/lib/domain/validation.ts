export type DomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SCHEMA_MISMATCH"
  | "INDEX_NOT_READY"
  | "DATABASE_UNAVAILABLE"
  | "CANCELLED"
  | "TIMEOUT";

/** Internal domain error; the platform maps this to the public error envelope. */
export class DomainError extends Error {
  readonly name = "DomainError";
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export function normalizeTitle(value: string): string {
  if (typeof value !== "string") throw new DomainError("INVALID_INPUT", "标题必须是文本", "title");
  const title = value.trim();
  if (Array.from(title).length < 1 || Array.from(title).length > 120) {
    throw new DomainError("INVALID_INPUT", "标题长度必须为 1–120 个 Unicode 字符", "title");
  }
  return title;
}

export function normalizeTags(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > 12)
    throw new DomainError("INVALID_INPUT", "标签最多 12 个", "tags");
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== "string") throw new DomainError("INVALID_INPUT", "标签必须是文本", "tags");
    const tag = raw.trim();
    if (!tag || Array.from(tag).length > 32)
      throw new DomainError("INVALID_INPUT", "标签长度必须为 1–32 个 Unicode 字符", "tags");
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

export function assertBodySize(value: string): void {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 2 * 1024 * 1024) {
    throw new DomainError("INVALID_INPUT", "正文必须为不超过 2 MiB 的文本", "contentMarkdown");
  }
}

export function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new DomainError("INVALID_INPUT", "revision 必须是从 1 开始的整数", "expectedRevision");
}

export function assertMutableRevision(
  record: { revision: number; deletedAt: string | null } | null,
  expectedRevision: number,
  restoring: boolean,
): void {
  assertRevision(expectedRevision);
  if (record === null) throw new DomainError("NOT_FOUND", "笔记不存在");
  assertRevision(record.revision);
  if (record.revision !== expectedRevision)
    throw new DomainError("CONFLICT", "笔记已更新，请重新加载");
  if (restoring && record.deletedAt === null) throw new DomainError("CONFLICT", "笔记当前未删除");
  if (!restoring && record.deletedAt !== null) throw new DomainError("NOT_FOUND", "笔记已删除");
}
