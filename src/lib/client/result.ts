import type { ApiResult, Command, PublicError } from "@/lib/contracts";

export const command = <T>(payload: T): Command<T> => ({ requestId: crypto.randomUUID(), payload });

export class ClientError extends Error {
  constructor(readonly detail: PublicError) {
    super(detail.message);
    this.name = "ClientError";
  }
}

export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new ClientError(result.error);
  return result.value;
}

export function readableError(error: unknown): string {
  return error instanceof ClientError
    ? error.detail.message
    : "操作未完成，请重试。编辑内容会保留。";
}
