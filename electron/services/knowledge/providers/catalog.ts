import { z } from "zod";
import {
  chatModelInfoSchema,
  type ChatModelInfo,
  type ConnectionReport,
  type ServiceContext,
  type SecretKind,
} from "../../../../src/lib/contracts";
import { DomainError } from "../../../../src/lib/domain/validation";
import { deadline } from "../async";
import { checkCancelled } from "../database/transactions";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
const rawModel = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  context_length: z.number().int().positive().nullable().optional(),
  top_provider: z
    .object({ max_completion_tokens: z.number().int().positive().nullable().optional() })
    .nullable()
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
});
export function createProviderCatalog(deps: {
  readSecret(kind: SecretKind): Promise<string | null>;
  fetch?: FetchLike;
}) {
  let cache: { expires: number; models: ChatModelInfo[] } | undefined;
  const fetcher = deps.fetch ?? fetch;
  const request = async (
    url: string,
    context: ServiceContext,
    init?: RequestInit,
  ): Promise<unknown> => {
    const scope = deadline(context.signal, 10_000, "连接测试");
    try {
      const response = await scope.wait(() => fetcher(url, { ...init, signal: scope.signal }));
      if (!response.ok)
        throw new DomainError(
          response.status === 401 || response.status === 403
            ? "PROVIDER_AUTH"
            : response.status === 429
              ? "PROVIDER_LIMIT"
              : "PROVIDER_UNAVAILABLE",
          "模型服务连接失败，请检查配置",
        );
      try {
        return await scope.wait(() => response.json());
      } catch (error) {
        scope.check();
        if (error instanceof DomainError) throw error;
        throw new DomainError("SCHEMA_MISMATCH", "模型服务响应格式无效");
      }
    } catch (error) {
      scope.check();
      if (error instanceof DomainError) throw error;
      throw new DomainError("PROVIDER_UNAVAILABLE", "模型服务网络请求失败");
    } finally {
      scope.dispose();
    }
  };
  const list = async (context: ServiceContext): Promise<ChatModelInfo[]> => {
    checkCancelled(context.signal);
    if (cache && cache.expires > Date.now()) return structuredClone(cache.models);
    const raw = await request("https://openrouter.ai/api/v1/models", context);
    const parsed = z.object({ data: z.array(rawModel).max(20_000) }).safeParse(raw);
    if (!parsed.success) throw new DomainError("SCHEMA_MISMATCH", "模型目录响应格式无效");
    const models = parsed.data.data.map((model) =>
      chatModelInfoSchema.parse({
        id: model.id,
        name: model.name,
        contextLength: model.context_length ?? null,
        maxOutputTokens: model.top_provider?.max_completion_tokens ?? null,
        supportsTemperature: model.supported_parameters
          ? model.supported_parameters.includes("temperature")
          : null,
      }),
    );
    cache = { expires: Date.now() + 300_000, models };
    return structuredClone(models);
  };
  return {
    list,
    async model(id: string, context: ServiceContext): Promise<ChatModelInfo> {
      const found = (await list(context)).find((model) => model.id === id);
      if (!found)
        throw new DomainError(
          "MODEL_UNSUPPORTED",
          "模型目录中找不到所选聊天模型，请验证模型 ID",
          "models",
        );
      return found;
    },
    clear() {
      cache = undefined;
    },
    async test(
      target: "openrouter" | "cohere",
      context: ServiceContext,
    ): Promise<ConnectionReport> {
      const start = performance.now();
      const key = await deps.readSecret(
        target === "openrouter" ? "openrouter-api-key" : "cohere-api-key",
      );
      if (!key) throw new DomainError("CONFIG_REQUIRED", "请先配置模型服务 API key");
      const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
      // These are authentication probes; neither endpoint generates embeddings, reranks, or chat.
      const response = await request(
        target === "openrouter"
          ? "https://openrouter.ai/api/v1/key"
          : "https://api.cohere.com/v1/check-api-key",
        context,
        target === "openrouter" ? { headers } : { method: "POST", headers, body: "{}" },
      );
      if (target === "cohere" && !z.object({ valid: z.literal(true) }).safeParse(response).success)
        throw new DomainError("PROVIDER_AUTH", "Cohere API key 验证失败");
      if (
        target === "openrouter" &&
        !z.object({ data: z.record(z.string(), z.unknown()) }).safeParse(response).success
      )
        throw new DomainError("SCHEMA_MISMATCH", "OpenRouter 鉴权响应格式无效");
      return {
        target,
        ok: true,
        latencyMs: performance.now() - start,
        message: "模型服务鉴权成功",
      };
    },
  };
}
