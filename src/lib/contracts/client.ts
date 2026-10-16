import type { ApiResult, IpcChannel, OperationEvent, RequestFor, ResponseFor } from "./schemas";

type Method<C extends IpcChannel> = (request: RequestFor<C>) => Promise<ApiResult<ResponseFor<C>>>;

export interface KnowledgeClient {
  system: {
    getInfo: Method<"system:get-info">;
    openExternal: Method<"system:open-external">;
    pickTextFiles: Method<"system:pick-text-files">;
  };
  collections: {
    list: Method<"collections:list">;
    save: Method<"collections:save">;
    remove: Method<"collections:remove">;
  };
  documents: {
    list: Method<"documents:list">;
    get: Method<"documents:get">;
    save: Method<"documents:save">;
    setFavorite: Method<"documents:set-favorite">;
    remove: Method<"documents:remove">;
    restore: Method<"documents:restore">;
    import: Method<"documents:import">;
  };
  search: { query: Method<"search:query">; cancel: Method<"search:cancel"> };
  settings: { get: Method<"settings:get">; update: Method<"settings:update"> };
  secrets: { set: Method<"secrets:set">; delete: Method<"secrets:delete"> };
  connections: { test: Method<"connections:test"> };
  models: { list: Method<"models:list"> };
  index: { status: Method<"index:status">; rebuild: Method<"index:rebuild"> };
  assistant: { start: Method<"assistant:start"> };
  operations: {
    cancel: Method<"operations:cancel">;
    subscribe(listener: (event: OperationEvent) => void): () => void;
  };
}
