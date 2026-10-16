import {
  apiErrorCodeSchema,
  uuidSchema,
  type ApiErrorCode,
  type PublicError,
  type SafeLogger,
  type Diagnostic,
} from "../../src/lib/contracts";

const messages: Record<ApiErrorCode, string> = {
  INVALID_INPUT: "输入格式或范围不正确，请检查填写内容。",
  UNAUTHORIZED: "不允许此调用来源或操作。",
  NOT_FOUND: "资料或操作不存在。",
  CONFLICT: "内容已被更新或操作正在运行，请刷新后重试。",
  DATABASE_UNAVAILABLE: "数据库暂不可用，请检查连接配置。",
  SCHEMA_MISMATCH: "数据版本或文件格式不兼容，请检查备份与迁移。",
  CONFIG_REQUIRED: "所需服务尚未配置或接入，请先完成配置。",
  PROVIDER_AUTH: "服务认证失败，请检查凭据。",
  PROVIDER_LIMIT: "服务额度或请求频率受限，请稍后重试。",
  PROVIDER_UNAVAILABLE: "云端服务暂不可用。",
  MODEL_UNSUPPORTED: "模型或参数不受当前服务支持。",
  INDEX_NOT_READY: "索引尚未就绪，请检查索引状态。",
  CANCELLED: "操作已取消。",
  TIMEOUT: "操作超时，请重试。",
  ENCRYPTION_UNAVAILABLE: "系统加密暂不可用，请改用仅本次会话保存。",
  INTERNAL: "操作未能完成，请重试或检查应用诊断。",
};
export class PlatformError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(messages[code]);
    this.name = "PlatformError";
  }
}
export function toPublicError(error: unknown): PublicError {
  const candidate =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const parsed = apiErrorCodeSchema.safeParse(candidate);
  const code = parsed.success
    ? parsed.data
    : error instanceof Error && error.name === "AbortError"
      ? "CANCELLED"
      : error instanceof Error && error.name === "ZodError"
        ? "INVALID_INPUT"
        : "INTERNAL";
  return {
    code,
    message: messages[code],
    retryable: [
      "DATABASE_UNAVAILABLE",
      "PROVIDER_LIMIT",
      "PROVIDER_UNAVAILABLE",
      "TIMEOUT",
      "INTERNAL",
    ].includes(code),
  };
}
export function createSafeLogger(
  sink: (line: string) => void = (line) => console.info(line),
): SafeLogger {
  const allowedEvents = new Set([
    "settings.updated",
    "ipc.rejected",
    "operation.failed",
    "service.unavailable",
    "provider.failure",
    "application.started",
    "application.stopped",
  ]);
  const write = (level: string, event: string, detail: Diagnostic = {}) => {
    const request = uuidSchema.safeParse(detail.requestId);
    const code = apiErrorCodeSchema.safeParse(detail.code);
    sink(
      JSON.stringify({
        level,
        event: allowedEvents.has(event) ? event : "diagnostic",
        ...(request.success ? { requestId: request.data } : {}),
        ...(code.success ? { code: code.data } : {}),
        ...(Number.isFinite(detail.durationMs) && detail.durationMs! >= 0
          ? { durationMs: Math.min(detail.durationMs!, 1e9) }
          : {}),
        ...(Number.isSafeInteger(detail.count) && detail.count! >= 0
          ? { count: Math.min(detail.count!, 1e9) }
          : {}),
      }),
    );
  };
  return {
    info: (event, detail) => write("info", event, detail),
    warn: (event, detail) => write("warn", event, detail),
    error: (event, detail) => write("error", event, detail),
  };
}
