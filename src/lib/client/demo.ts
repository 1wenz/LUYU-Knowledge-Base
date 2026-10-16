"use client";

import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  LIMITS,
  collectionSchema,
  documentSchema,
  publicSettingsSchema,
  requestSchemas,
  responseSchemas,
  uuidSchema,
  type ApiErrorCode,
  type ApiResult,
  type Citation,
  type Collection,
  type Document,
  type DocumentMutation,
  type IpcChannel,
  type KnowledgeClient,
  type OperationEvent,
  type OperationPayload,
  type ParsedRequestFor,
  type RequestFor,
  type ResponseFor,
  type SearchRequest,
  type SearchResponse,
  type SecretStatus,
  type SettingsView,
} from "@/lib/contracts";

export const DEMO_STORAGE_KEY = "zhiyu:demo:v1";
const stateSchema = z.strictObject({
  version: z.literal(1),
  collections: z.array(collectionSchema).max(10000),
  documents: z.array(documentSchema).max(10000),
  settings: publicSettingsSchema,
  imported: z.record(z.string(), z.array(uuidSchema)),
  requiresReindex: z.boolean(),
  generationId: uuidSchema.nullable(),
});
type DemoState = z.infer<typeof stateSchema>;
type Operation = { seq: number; terminal: boolean; timers: Set<ReturnType<typeof setTimeout>> };

export type DemoOptions = {
  searchDelayMs?: (query: string) => number;
  ignoreSearchCancel?: boolean;
  searchError?: ApiErrorCode;
  rerankFailure?: boolean;
  assistantFailure?: boolean;
};

class DemoError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function emptyState(): DemoState {
  return {
    version: 1,
    collections: [
      { id: "29ccaa50-a0bf-4e34-a864-81d5564f5601", name: "产品设计", sortOrder: 0 },
      { id: "29ccaa50-a0bf-4e34-a864-81d5564f5602", name: "技术笔记", sortOrder: 1 },
      { id: "29ccaa50-a0bf-4e34-a864-81d5564f5603", name: "灵感碎片", sortOrder: 2 },
    ],
    documents: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    imported: {},
    requiresReindex: false,
    generationId: null,
  };
}

const emptySecrets = (): SecretStatus => ({
  "openrouter-api-key": { configured: false, persistence: "none" },
  "cohere-api-key": { configured: false, persistence: "none" },
  "database-password": { configured: false, persistence: "none" },
});

export function createDemoClient(
  storage: Pick<Storage, "getItem" | "setItem">,
  options: DemoOptions = {},
): KnowledgeClient {
  const listeners = new Set<(event: OperationEvent) => void>();
  const searches = new Map<string, AbortController>();
  const operations = new Map<string, Operation>();
  let secrets = emptySecrets();
  let buildingId: string | null = null;

  function read(): DemoState {
    const raw = storage.getItem(DEMO_STORAGE_KEY);
    return raw === null ? emptyState() : stateSchema.parse(JSON.parse(raw));
  }
  read(); // Corrupt data must stop client creation, never silently create a new store.

  function write(next: DemoState) {
    const validated = stateSchema.parse(next);
    try {
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(validated));
    } catch {
      throw new DemoError(
        "INTERNAL",
        "演示数据保存失败，请检查浏览器存储权限或可用空间。编辑内容已保留。",
      );
    }
  }

  async function handle<C extends IpcChannel>(
    channel: C,
    input: RequestFor<C>,
    run: (request: ParsedRequestFor<C>) => ResponseFor<C> | Promise<ResponseFor<C>>,
  ): Promise<ApiResult<ResponseFor<C>>> {
    const requestId = uuidSchema.safeParse(input.requestId).success
      ? input.requestId
      : crypto.randomUUID();
    const parsed = requestSchemas[channel].safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        requestId,
        error: {
          code: "INVALID_INPUT",
          message: "输入不符合要求，请检查字段范围。",
          retryable: false,
        },
      };
    try {
      const value = await run(parsed.data as ParsedRequestFor<C>);
      const checked = responseSchemas[channel].parse(value) as ResponseFor<C>;
      return { ok: true, value: checked, requestId };
    } catch (error) {
      const code = error instanceof DemoError ? error.code : "INTERNAL";
      return {
        ok: false,
        requestId,
        error: {
          code,
          message:
            error instanceof DemoError
              ? error.message
              : "演示操作未完成。请备份数据后重试，原数据不会自动清空。",
          retryable: !["INVALID_INPUT", "NOT_FOUND", "CONFLICT"].includes(code),
        },
      };
    }
  }

  function findDocument(state: DemoState, id: string): Document {
    const doc = state.documents.find((item) => item.id === id);
    if (!doc) throw new DemoError("NOT_FOUND", "这篇笔记已不存在，请刷新列表。");
    return doc;
  }

  function changeDocument(
    mutation: DocumentMutation,
    update: (document: Document) => Partial<Document>,
    allowDeleted = false,
  ): Document {
    const state = read();
    const doc = findDocument(state, mutation.id);
    if (doc.revision !== mutation.expectedRevision)
      throw new DemoError(
        "CONFLICT",
        "笔记已被其他窗口修改。请重新加载最新版本，当前编辑内容会保留。",
      );
    if (doc.deletedAt && !allowDeleted)
      throw new DemoError("NOT_FOUND", "笔记已移到回收站，请先恢复。");
    const next = {
      ...doc,
      ...update(doc),
      revision: doc.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    state.documents = state.documents.map((item) => (item.id === next.id ? next : item));
    write(state);
    return next;
  }

  function view(state = read()): SettingsView {
    return {
      settings: structuredClone(state.settings),
      secrets: structuredClone(secrets),
      index: { activeGenerationId: state.generationId, requiresReindex: state.requiresReindex },
    };
  }

  function emit(id: string, payload: OperationPayload) {
    const operation = operations.get(id);
    if (!operation || operation.terminal) return;
    if (["completed", "cancelled", "failed"].includes(payload.type)) {
      operation.terminal = true;
      for (const timer of operation.timers) clearTimeout(timer);
      operation.timers.clear();
    }
    const event: OperationEvent = { operationId: id, seq: ++operation.seq, payload };
    for (const listener of listeners) listener(event);
  }

  function schedule(id: string, delay: number, action: () => void) {
    const operation = operations.get(id);
    if (!operation || operation.terminal) return;
    const timer = setTimeout(() => {
      operation.timers.delete(timer);
      if (!operation.terminal) action();
    }, delay);
    operation.timers.add(timer);
  }

  function begin(id: string, kind: "assistant" | "reindex") {
    if (operations.has(id)) throw new DemoError("CONFLICT", "操作标识已使用，请重试。");
    if ([...operations.values()].some((op) => !op.terminal))
      throw new DemoError("CONFLICT", "请先停止当前操作。");
    operations.set(id, { seq: 0, terminal: false, timers: new Set() });
    emit(id, { type: "started", kind }); // Deliberately before start resolves: subscribers must register first.
  }

  async function chunkId(value: string): Promise<string> {
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function query(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    const started = performance.now();
    const delay = options.searchDelayMs?.(request.query) ?? 60;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new DemoError("CANCELLED", "检索已取消。"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, delay);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
    if (options.searchError)
      throw new DemoError(
        options.searchError,
        "数据库暂时无法连接。请打开设置测试连接，然后重试。",
      );
    const state = read();
    const needle = request.query.toLocaleLowerCase();
    const documents = state.documents.filter(
      (doc) =>
        !doc.deletedAt &&
        (!request.filters?.collectionId || doc.collectionId === request.filters.collectionId) &&
        (!request.filters?.favoriteOnly || doc.favorite) &&
        (!request.filters?.tags?.length ||
          request.filters.tags.every((tag) => doc.tags.includes(tag))),
    );
    const hits: SearchResponse["hits"] = [];
    for (const doc of documents) {
      const lines = doc.contentMarkdown.split("\n");
      for (let index = 0; index < lines.length; index += 10) {
        const snippet = Array.from(lines.slice(index, index + 10).join("\n"))
          .slice(0, 1600)
          .join("");
        if (![doc.title, ...doc.tags, snippet].join(" ").toLocaleLowerCase().includes(needle))
          continue;
        hits.push({
          chunkId: await chunkId(`${doc.id}:${doc.revision}:${index}`),
          documentId: doc.id,
          documentRevision: doc.revision,
          title: doc.title,
          snippet,
          startLine: index + 1,
          endLine: Math.min(index + 10, lines.length),
          updatedAt: doc.updatedAt,
          scores: { keywordRank: hits.length + 1, rrf: 1 / (61 + hits.length) },
        });
      }
    }
    if (signal?.aborted) throw new DemoError("CANCELLED", "检索已取消。");
    return {
      requestId: request.requestId,
      mode: "keyword",
      generationId: state.generationId,
      hits: hits.slice(0, request.resultCount ?? state.settings.retrieval.resultCount),
      warnings: [
        {
          stage: "embedding",
          reason: "not-configured",
          message: "浏览器演示使用本地关键词检索，未调用云端向量模型。",
        },
        ...(options.rerankFailure
          ? [
              {
                stage: "rerank" as const,
                reason: "failed" as const,
                message: "重排暂时不可用，已保留召回顺序。",
              },
            ]
          : []),
      ],
      timingsMs: { total: performance.now() - started },
    };
  }

  const client: KnowledgeClient = {
    system: {
      getInfo: (input) =>
        handle("system:get-info", input, () => ({
          apiVersion: 1,
          name: "知屿",
          productName: "Zhiyu",
          version: "0.1.0-demo",
          platform: "browser",
          arch: "unknown",
          versions: { electron: "未配置", chrome: "浏览器", node: "未配置" },
          developer: {
            name: null,
            homepage: null,
            repository: null,
            support: null,
            license: "MIT",
            copyright: null,
          },
          mode: "demo",
        })),
      openExternal: (input) =>
        handle("system:open-external", input, (request) => {
          let url: URL;
          try {
            url = new URL(request.payload.url);
          } catch {
            throw new DemoError("INVALID_INPUT", "链接地址无效。");
          }
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
            throw new DemoError("INVALID_INPUT", "只允许不含凭据的 HTTP 或 HTTPS 链接。");
          window.open(url.href, "_blank", "noopener,noreferrer");
          return { opened: true };
        }),
      pickTextFiles: (input) =>
        handle(
          "system:pick-text-files",
          input,
          () =>
            new Promise((resolve, reject) => {
              const picker = document.createElement("input");
              picker.type = "file";
              picker.accept = ".md,.markdown,.txt";
              picker.multiple = true;
              picker.addEventListener("cancel", () => resolve({ files: [] }), { once: true });
              picker.addEventListener(
                "change",
                async () => {
                  try {
                    const selected = Array.from(picker.files ?? []);
                    if (
                      selected.length > LIMITS.importCount ||
                      selected.reduce((sum, file) => sum + file.size, 0) > LIMITS.importBytes
                    )
                      throw new DemoError(
                        "INVALID_INPUT",
                        "一次最多导入 100 个文件，总大小不能超过 8 MiB。",
                      );
                    const files = await Promise.all(
                      selected.map(async (file) => {
                        if (
                          !/\.(md|markdown|txt)$/i.test(file.name) ||
                          file.size > LIMITS.documentBytes
                        )
                          throw new DemoError(
                            "INVALID_INPUT",
                            "仅支持不超过 2 MiB 的 Markdown 或 TXT 文件。",
                          );
                        let content: string;
                        try {
                          content = new TextDecoder("utf-8", { fatal: true }).decode(
                            await file.arrayBuffer(),
                          );
                        } catch {
                          throw new DemoError("INVALID_INPUT", "文件不是有效的 UTF-8 文本。");
                        }
                        return { name: file.name, content };
                      }),
                    );
                    resolve({ files });
                  } catch (error) {
                    reject(error);
                  }
                },
                { once: true },
              );
              picker.click();
            }),
        ),
    },
    collections: {
      list: (input) =>
        handle("collections:list", input, () =>
          read().collections.sort((a, b) => a.sortOrder - b.sortOrder),
        ),
      save: (input) =>
        handle("collections:save", input, (request) => {
          const state = read();
          const old = request.payload.id
            ? state.collections.find((item) => item.id === request.payload.id)
            : null;
          if (request.payload.id && !old)
            throw new DemoError("NOT_FOUND", "分类已不存在，请刷新。");
          const collection: Collection = { ...request.payload, id: old?.id ?? crypto.randomUUID() };
          state.collections = [
            ...state.collections.filter((item) => item.id !== collection.id),
            collection,
          ];
          write(state);
          return collection;
        }),
      remove: (input) =>
        handle("collections:remove", input, (request) => {
          const state = read();
          if (!state.collections.some((item) => item.id === request.payload.id))
            throw new DemoError("NOT_FOUND", "分类已不存在。");
          state.collections = state.collections.filter((item) => item.id !== request.payload.id);
          state.documents = state.documents.map((doc) =>
            doc.collectionId === request.payload.id
              ? {
                  ...doc,
                  collectionId: null,
                  revision: doc.revision + 1,
                  updatedAt: new Date().toISOString(),
                }
              : doc,
          );
          write(state);
          return { removed: true };
        }),
    },
    documents: {
      list: (input) =>
        handle("documents:list", input, (request) => {
          const payload = request.payload;
          const docs = read()
            .documents.filter(
              (doc) =>
                (payload.view === "trash" ? !!doc.deletedAt : !doc.deletedAt) &&
                (payload.view !== "favorites" || doc.favorite) &&
                (!payload.collectionId || doc.collectionId === payload.collectionId) &&
                (!payload.tag || doc.tags.includes(payload.tag)),
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return {
            total: docs.length,
            items: docs.slice(payload.offset, payload.offset + payload.limit).map((doc) => {
              const { contentMarkdown, ...summary } = doc;
              return { ...summary, excerpt: Array.from(contentMarkdown).slice(0, 200).join("") };
            }),
          };
        }),
      get: (input) =>
        handle("documents:get", input, (request) => findDocument(read(), request.payload.id)),
      save: (input) =>
        handle("documents:save", input, (request) => {
          const { draft, existing } = request.payload;
          const state = read();
          if (
            draft.collectionId &&
            !state.collections.some((item) => item.id === draft.collectionId)
          )
            throw new DemoError("INVALID_INPUT", "请选择当前存在的分类。");
          if (existing)
            return changeDocument(
              { id: existing.id, expectedRevision: existing.expectedRevision },
              () => draft,
            );
          const now = new Date().toISOString();
          const doc: Document = {
            ...draft,
            id: crypto.randomUUID(),
            favorite: false,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
          state.documents.unshift(doc);
          write(state);
          return doc;
        }),
      setFavorite: (input) =>
        handle("documents:set-favorite", input, (request) =>
          changeDocument(request.payload, () => ({ favorite: request.payload.favorite })),
        ),
      remove: (input) =>
        handle("documents:remove", input, (request) =>
          changeDocument(request.payload, () => ({ deletedAt: new Date().toISOString() })),
        ),
      restore: (input) =>
        handle("documents:restore", input, (request) =>
          changeDocument(
            request.payload,
            (doc) => {
              if (!doc.deletedAt) throw new DemoError("INVALID_INPUT", "笔记已恢复，请刷新列表。");
              return { deletedAt: null };
            },
            true,
          ),
        ),
      import: (input) =>
        handle("documents:import", input, (request) => {
          const state = read();
          const payload = request.payload;
          const previous = Object.hasOwn(state.imported, payload.sourceFingerprint)
            ? state.imported[payload.sourceFingerprint]
            : undefined;
          if (previous)
            return { imported: 0, skipped: payload.items.length, documentIds: previous };
          const ids: string[] = [];
          const sourceIds = new Set<string>();
          let skipped = 0;
          for (const item of payload.items) {
            if (sourceIds.has(item.sourceId)) {
              skipped++;
              continue;
            }
            sourceIds.add(item.sourceId);
            if (
              item.draft.collectionId &&
              !state.collections.some((collection) => collection.id === item.draft.collectionId)
            )
              throw new DemoError("INVALID_INPUT", "导入分类已失效，请重新选择。");
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            ids.push(id);
            state.documents.push({
              ...item.draft,
              id,
              revision: 1,
              favorite: false,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            });
          }
          state.imported[payload.sourceFingerprint] = ids;
          write(state);
          return { imported: ids.length, skipped, documentIds: ids };
        }),
    },
    search: {
      query: (input) =>
        handle("search:query", input, async (request) => {
          const abort = new AbortController();
          searches.set(request.requestId, abort);
          try {
            return await query(request, abort.signal);
          } finally {
            searches.delete(request.requestId);
          }
        }),
      cancel: (input) =>
        handle("search:cancel", input, (request) => {
          const pending = searches.get(request.payload.requestIdToCancel);
          if (!options.ignoreSearchCancel) pending?.abort();
          return { cancelled: !!pending };
        }),
    },
    settings: {
      get: (input) => handle("settings:get", input, () => view()),
      update: (input) =>
        handle("settings:update", input, (request) => {
          const state = read();
          if (request.payload.expectedRevision !== state.settings.revision)
            throw new DemoError("CONFLICT", "设置已被其他窗口更新，请重新加载后提交。");
          const before = state.settings;
          const after = publicSettingsSchema.parse({
            ...before,
            ...request.payload.patch,
            revision: before.revision + 1,
          });
          state.requiresReindex ||=
            before.models.embeddingDimensions !== after.models.embeddingDimensions ||
            JSON.stringify(before.indexing) !== JSON.stringify(after.indexing);
          state.settings = after;
          write(state);
          return view(state);
        }),
    },
    secrets: {
      set: (input) =>
        handle("secrets:set", input, (request) => {
          if (request.payload.persistence === "encrypted")
            throw new DemoError(
              "ENCRYPTION_UNAVAILABLE",
              "浏览器演示只能使用会话标记；真实加密凭据请在桌面应用设置。",
            );
          secrets = {
            ...secrets,
            [request.payload.kind]: { configured: true, persistence: "session" },
          };
          return structuredClone(secrets); // Value deliberately discarded, never persisted or logged.
        }),
      delete: (input) =>
        handle("secrets:delete", input, (request) => {
          secrets = {
            ...secrets,
            [request.payload.kind]: { configured: false, persistence: "none" },
          };
          return structuredClone(secrets);
        }),
    },
    connections: {
      test: (input) =>
        handle("connections:test", input, (request) => ({
          target: request.payload.target,
          ok: false,
          latencyMs: 0,
          message: "浏览器演示不建立真实连接，请在桌面应用中测试。",
        })),
    },
    models: {
      list: (input) =>
        handle("models:list", input, () => [
          {
            id: "demo/preview",
            name: "界面演示（不调用云端）",
            contextLength: null,
            maxOutputTokens: null,
            supportsTemperature: null,
          },
        ]),
    },
    index: {
      status: (input) =>
        handle("index:status", input, () => {
          const state = read();
          const count = state.documents.filter((doc) => !doc.deletedAt).length;
          return {
            activeGenerationId: state.generationId,
            buildingGenerationId: buildingId,
            documentCount: count,
            chunkCount: count,
            pendingCount: count,
            failedCount: 0,
            requiresReindex: state.requiresReindex,
            lastErrorCode: null,
          };
        }),
      rebuild: (input) =>
        handle("index:rebuild", input, (request) => {
          begin(request.requestId, "reindex");
          buildingId = crypto.randomUUID();
          const count = read().documents.filter((doc) => !doc.deletedAt).length;
          schedule(request.requestId, 200, () =>
            emit(request.requestId, { type: "progress", completed: 0, total: count, failed: 0 }),
          );
          schedule(request.requestId, 900, () => {
            const state = read();
            state.generationId = buildingId;
            state.requiresReindex = false;
            write(state);
            buildingId = null;
            emit(request.requestId, {
              type: "progress",
              completed: count,
              total: count,
              failed: 0,
            });
            emit(request.requestId, { type: "completed" });
          });
          return { operationId: request.requestId };
        }),
    },
    assistant: {
      start: (input) =>
        handle("assistant:start", input, (request) => {
          if (!read().settings.models.chatModel)
            throw new DemoError(
              "CONFIG_REQUIRED",
              "请先在模型设置中选择聊天模型。演示模式可选择“界面演示”。",
            );
          begin(request.requestId, "assistant");
          emit(request.requestId, { type: "retrieving" });
          void query({
            requestId: request.requestId,
            query: request.payload.question,
            filters: request.payload.filters,
          })
            .then((search) => {
              if (operations.get(request.requestId)?.terminal) return;
              const citations: Citation[] = search.hits.map(
                ({ chunkId, documentId, documentRevision, title, startLine, endLine }) => ({
                  chunkId,
                  documentId,
                  documentRevision,
                  title,
                  startLine,
                  endLine,
                }),
              );
              emit(request.requestId, { type: "context", search, citations });
              const text = citations.length
                ? "这是浏览器演示回复，用于验证流式显示与来源定位。请打开下方来源核对原文。"
                : "没有找到可以引用的资料。请添加笔记，或使用笔记中的关键词再次提问。";
              if (options.assistantFailure) {
                schedule(request.requestId, 150, () =>
                  emit(request.requestId, {
                    type: "failed",
                    error: {
                      code: "PROVIDER_UNAVAILABLE",
                      message: "回答暂时中断，请重试。",
                      retryable: true,
                    },
                  }),
                );
                return;
              }
              const pieces = text.match(/.{1,6}/gu) ?? [];
              pieces.forEach((piece, index) =>
                schedule(request.requestId, 150 + index * 80, () =>
                  emit(request.requestId, { type: "delta", text: piece }),
                ),
              );
              schedule(request.requestId, 230 + pieces.length * 80, () =>
                emit(request.requestId, { type: "completed", text, citations }),
              );
            })
            .catch(() =>
              emit(request.requestId, {
                type: "failed",
                error: { code: "INTERNAL", message: "演示检索失败，请重试。", retryable: true },
              }),
            );
          return { operationId: request.requestId };
        }),
    },
    operations: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      cancel: (input) =>
        handle("operations:cancel", input, (request) => {
          const operation = operations.get(request.payload.operationId);
          if (operation && !operation.terminal) {
            emit(request.payload.operationId, { type: "cancelled" });
            buildingId = null;
          }
          return { cancelled: !!operation };
        }),
    },
  };
  return client;
}
