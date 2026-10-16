import {
  apiResultSchema,
  operationEventSchema,
  responseSchemas,
  uuidSchema,
  type ApiResult,
  type IpcChannel,
  type KnowledgeClient,
  type RequestFor,
  type ResponseFor,
} from "../../src/lib/contracts";

export interface BridgeTransport {
  invoke(channel: string, request: unknown): Promise<unknown>;
  subscribe(channel: "operation:event", listener: (input: unknown) => void): () => void;
}
export function createPreloadClient(transport: BridgeTransport): KnowledgeClient {
  const invoke = async <C extends IpcChannel>(
    channel: C,
    request: RequestFor<C>,
  ): Promise<ApiResult<ResponseFor<C>>> => {
    const id = uuidSchema.safeParse(request?.requestId);
    const requestId = id.success ? id.data : "00000000-0000-4000-8000-000000000000";
    if (!id.success)
      return {
        ok: false,
        requestId,
        error: { code: "INVALID_INPUT", message: "请求标识格式不正确。", retryable: false },
      };
    try {
      const raw = await transport.invoke(channel, request);
      const result = apiResultSchema(responseSchemas[channel]).safeParse(raw);
      if (result.success && result.data.requestId === requestId)
        return result.data as ApiResult<ResponseFor<C>>;
    } catch {
      /* Raw transport messages can contain paths; expose only the fixed public error below. */
    }
    return {
      ok: false,
      requestId,
      error: { code: "INTERNAL", message: "桌面通信暂不可用，请重试。", retryable: true },
    };
  };
  const method =
    <C extends IpcChannel>(channel: C) =>
    (request: RequestFor<C>) =>
      invoke(channel, request);
  return Object.freeze({
    system: Object.freeze({
      getInfo: method("system:get-info"),
      openExternal: method("system:open-external"),
      pickTextFiles: method("system:pick-text-files"),
    }),
    collections: Object.freeze({
      list: method("collections:list"),
      save: method("collections:save"),
      remove: method("collections:remove"),
    }),
    documents: Object.freeze({
      list: method("documents:list"),
      get: method("documents:get"),
      save: method("documents:save"),
      setFavorite: method("documents:set-favorite"),
      remove: method("documents:remove"),
      restore: method("documents:restore"),
      import: method("documents:import"),
    }),
    search: Object.freeze({ query: method("search:query"), cancel: method("search:cancel") }),
    settings: Object.freeze({ get: method("settings:get"), update: method("settings:update") }),
    secrets: Object.freeze({ set: method("secrets:set"), delete: method("secrets:delete") }),
    connections: Object.freeze({ test: method("connections:test") }),
    models: Object.freeze({ list: method("models:list") }),
    index: Object.freeze({ status: method("index:status"), rebuild: method("index:rebuild") }),
    assistant: Object.freeze({ start: method("assistant:start") }),
    operations: Object.freeze({
      cancel: method("operations:cancel"),
      subscribe(listener: Parameters<KnowledgeClient["operations"]["subscribe"]>[0]) {
        return transport.subscribe("operation:event", (input) => {
          const event = operationEventSchema.safeParse(input);
          if (event.success) listener(event.data);
        });
      },
    }),
  });
}
