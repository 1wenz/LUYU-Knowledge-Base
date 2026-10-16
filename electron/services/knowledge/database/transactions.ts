import { DomainError } from "../../../../src/lib/domain/validation";
import type { ApiErrorCode, ServiceContext } from "../../../../src/lib/contracts";
import type { SqlConnection, SqlPool } from "./ports";

export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DomainError("CANCELLED", "操作已取消");
}

export function databaseError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const sqlCode =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const code: ApiErrorCode =
    sqlCode === "23503"
      ? "INVALID_INPUT"
      : sqlCode === "23505" || sqlCode === "40001" || sqlCode === "40P01"
        ? "CONFLICT"
        : sqlCode === "57014" || sqlCode === "55P03"
          ? "TIMEOUT"
          : sqlCode.startsWith("42")
            ? "SCHEMA_MISMATCH"
            : "DATABASE_UNAVAILABLE";
  return new DomainError(
    code,
    code === "CONFLICT"
      ? "数据已改变，请重新加载后重试"
      : code === "INVALID_INPUT"
        ? "关联数据不存在，请重新选择分类"
        : code === "TIMEOUT"
          ? "数据库操作超时，请稍后重试"
          : "数据库操作失败，请检查数据库状态",
  );
}

export async function inTransaction<T>(
  pool: SqlPool,
  context: ServiceContext,
  work: (connection: SqlConnection) => Promise<T>,
  readOnly = false,
): Promise<T> {
  checkCancelled(context.signal);
  const connection = await pool.connect().catch((error: unknown) => {
    throw databaseError(error);
  });
  let started = false;
  let discard = false;
  const guarded: SqlConnection = {
    async query<Row extends object>(text: string, values = []) {
      checkCancelled(context.signal);
      const result = await connection.query<Row>(text, values);
      checkCancelled(context.signal);
      return result;
    },
    release: () => {
      throw new DomainError("INTERNAL", "事务连接由调用方管理");
    },
  };
  try {
    checkCancelled(context.signal);
    await connection.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    started = true;
    await guarded.query(
      "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)",
      ["5000"],
    );
    const result = await work(guarded);
    checkCancelled(context.signal);
    await connection.query("COMMIT");
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try {
        await connection.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    if (context.signal.aborted) throw new DomainError("CANCELLED", "操作已取消");
    throw databaseError(error);
  } finally {
    connection.release(discard);
  }
}
