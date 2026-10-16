import {
  documentDraftSchema,
  documentMutationSchema,
  type ApiErrorCode,
  type PublicError,
} from "../contracts";
export type DomainErrorCode = ApiErrorCode;

/** Internal domain error; the platform maps this to the public error envelope. */
export class DomainError extends Error {
  readonly name = "DomainError";
  readonly retryable: boolean;
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly field?: PublicError["field"],
  ) {
    super(message);
    this.retryable = [
      "DATABASE_UNAVAILABLE",
      "TIMEOUT",
      "PROVIDER_LIMIT",
      "PROVIDER_UNAVAILABLE",
    ].includes(code);
  }
}

export function normalizeTitle(value: string): string {
  const result = documentDraftSchema.shape.title.safeParse(value);
  if (!result.success) throw new DomainError("INVALID_INPUT", "标题不符合长度要求", "title");
  return result.data;
}

export function normalizeTags(values: string[]): string[] {
  const result = documentDraftSchema.shape.tags.safeParse(values);
  if (!result.success) throw new DomainError("INVALID_INPUT", "标签不符合数量或长度要求", "tags");
  return result.data;
}

export function assertBodySize(value: string): void {
  if (!documentDraftSchema.shape.contentMarkdown.safeParse(value).success) {
    throw new DomainError("INVALID_INPUT", "正文必须为不超过 2 MiB 的文本", "contentMarkdown");
  }
}

export function assertRevision(revision: number): void {
  if (!documentMutationSchema.shape.expectedRevision.safeParse(revision).success)
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
