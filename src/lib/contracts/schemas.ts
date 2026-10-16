import { z } from "zod";

export const API_VERSION = 1 as const;
export const LIMITS = {
  documentBytes: 2 * 1024 * 1024,
  importBytes: 8 * 1024 * 1024,
  importCount: 100,
  deltaBytes: 16 * 1024,
} as const;

// Works in the sandboxed preload as well as Node; never import Buffer or Electron here.
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= min && length <= max;
    }, "文字长度超出范围。");
const plainText = (max: number) => z.string().refine((value) => Array.from(value).length <= max);
const integer = (min: number, max = Number.MAX_SAFE_INTEGER) => z.number().int().min(min).max(max);
export const uuidSchema = z.uuid();
const date = z.iso.datetime();
const empty = z.strictObject({});
const tags = z
  .array(text(32))
  .max(12)
  .transform((items) => [...new Set(items)]);

export const apiErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "CONFLICT",
  "DATABASE_UNAVAILABLE",
  "SCHEMA_MISMATCH",
  "CONFIG_REQUIRED",
  "PROVIDER_AUTH",
  "PROVIDER_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "MODEL_UNSUPPORTED",
  "INDEX_NOT_READY",
  "CANCELLED",
  "TIMEOUT",
  "ENCRYPTION_UNAVAILABLE",
  "INTERNAL",
]);
export const publicErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: text(300),
  retryable: z.boolean(),
  field: z
    .enum([
      "title",
      "contentMarkdown",
      "collectionId",
      "tags",
      "query",
      "question",
      "database",
      "models",
      "indexing",
      "retrieval",
      "generation",
      "appearance",
      "expectedRevision",
      "requestId",
      "kind",
      "value",
      "persistence",
      "url",
    ])
    .optional(),
});
export const commandSchema = <T extends z.ZodType>(payload: T) =>
  z.strictObject({ requestId: uuidSchema, payload });
export const apiResultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), value, requestId: uuidSchema }),
    z.strictObject({ ok: z.literal(false), error: publicErrorSchema, requestId: uuidSchema }),
  ]);

export const collectionSchema = z.strictObject({
  id: uuidSchema,
  name: text(80),
  sortOrder: integer(0, 100000),
});
export const collectionSaveSchema = z.strictObject({
  id: uuidSchema.optional(),
  name: text(80),
  sortOrder: integer(0, 100000),
});
export const documentDraftSchema = z.strictObject({
  title: text(120),
  contentMarkdown: z
    .string()
    .refine((value) => utf8Bytes(value) <= LIMITS.documentBytes, "正文超过 2 MiB。"),
  collectionId: uuidSchema.nullable(),
  tags,
});
export const documentSchema = z.strictObject({
  ...documentDraftSchema.shape,
  id: uuidSchema,
  favorite: z.boolean(),
  revision: integer(1),
  createdAt: date,
  updatedAt: date,
  deletedAt: date.nullable(),
});
export const documentSummarySchema = documentSchema
  .omit({ contentMarkdown: true })
  .extend({ excerpt: plainText(1600) });
export const documentPageSchema = z.strictObject({
  items: z.array(documentSummarySchema).max(100),
  total: integer(0),
});
export const saveDocumentSchema = z.strictObject({
  draft: documentDraftSchema,
  existing: z.strictObject({ id: uuidSchema, expectedRevision: integer(1) }).optional(),
});
export const documentMutationSchema = z.strictObject({
  id: uuidSchema,
  expectedRevision: integer(1),
});
export const listDocumentsSchema = z.strictObject({
  collectionId: uuidSchema.optional(),
  tag: text(32).optional(),
  view: z.enum(["all", "favorites", "recent", "trash"]),
  offset: integer(0).default(0),
  limit: integer(1, 100).default(50),
});
export const batchImportSchema = z
  .strictObject({
    sourceFingerprint: text(256),
    items: z
      .array(z.strictObject({ sourceId: text(256), draft: documentDraftSchema }))
      .min(1)
      .max(LIMITS.importCount),
  })
  .refine(
    (batch) => utf8Bytes(JSON.stringify(batch)) <= LIMITS.importBytes,
    "导入总量超过 8 MiB。",
  );
export const importReportSchema = z.strictObject({
  imported: integer(0, 100),
  skipped: integer(0, 100),
  documentIds: z.array(uuidSchema).max(100),
});
export const searchFiltersSchema = z.strictObject({
  collectionId: uuidSchema.optional(),
  tags: tags.optional(),
  favoriteOnly: z.boolean().optional(),
});
export const searchRequestSchema = z.strictObject({
  requestId: uuidSchema,
  query: text(2000),
  filters: searchFiltersSchema.optional(),
  resultCount: integer(1, 20).optional(),
});
export const searchHitSchema = z
  .strictObject({
    chunkId: uuidSchema,
    documentId: uuidSchema,
    documentRevision: integer(1),
    title: text(120),
    snippet: plainText(1600),
    startLine: integer(1),
    endLine: integer(1),
    updatedAt: date,
    scores: z.strictObject({
      keywordRank: integer(1).optional(),
      vectorRank: integer(1).optional(),
      vectorCosine: z.number().min(-1).max(1).optional(),
      rrf: z.number().nonnegative(),
      rerank: z.number().finite().optional(),
    }),
  })
  .refine((hit) => hit.endLine >= hit.startLine);
export const searchWarningSchema = z.strictObject({
  stage: z.enum(["keyword", "embedding", "vector", "rerank"]),
  reason: z.enum(["not-configured", "disabled", "index-pending", "failed", "timeout"]),
  message: text(300),
});
export const searchResponseSchema = z.strictObject({
  requestId: uuidSchema,
  mode: z.enum(["hybrid-rerank", "hybrid", "keyword", "vector"]),
  generationId: uuidSchema.nullable(),
  hits: z.array(searchHitSchema).max(20),
  warnings: z.array(searchWarningSchema).max(8),
  timingsMs: z.strictObject({
    keyword: z.number().nonnegative().optional(),
    embedding: z.number().nonnegative().optional(),
    vector: z.number().nonnegative().optional(),
    fusion: z.number().nonnegative().optional(),
    rerank: z.number().nonnegative().optional(),
    total: z.number().nonnegative(),
  }),
});

export function isLoopback(host: string): boolean {
  if (["localhost", "::1", "[::1]"].includes(host.toLowerCase())) return true;
  return (
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) &&
    host.split(".").every((part) => Number(part) <= 255)
  );
}
const hostSchema = text(253).refine((host) => {
  if (host.includes(":")) return /^\[?[a-fA-F0-9:]+\]?$/.test(host) && host.includes("::");
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) && !host.includes("..");
}, "主机名不能包含协议、端口、路径或凭据。");
export const databaseSettingsSchema = z
  .strictObject({
    host: hostSchema,
    port: integer(1, 65535),
    database: text(63).refine((value) => /^[\w.-]+$/.test(value)),
    user: text(63).refine((value) => /^[\w.-]+$/.test(value)),
    sslMode: z.enum(["disable", "verify-full"]),
  })
  .refine(
    (value) => isLoopback(value.host) || value.sslMode === "verify-full",
    "远程连接必须启用证书验证。",
  );
export const modelSettingsSchema = z.strictObject({
  chatModel: text(200)
    .refine((value) => /^[\w./:-]+$/.test(value) && !value.includes("://"))
    .nullable(),
  embeddingModel: z.literal("openai/text-embedding-3-large"),
  embeddingDimensions: z.union([z.literal(1536), z.literal(3072)]),
  rerankModel: z.literal("rerank-v3.5"),
});
export const indexingSettingsSchema = z
  .strictObject({ chunkTokens: integer(200, 2000), overlapTokens: integer(0, 400) })
  .refine((value) => value.overlapTokens < value.chunkTokens / 2, "重叠量必须小于片段长度的一半。");
export const retrievalSettingsSchema = z
  .strictObject({
    keywordCandidates: integer(5, 100),
    vectorCandidates: integer(5, 100),
    vectorOversample: integer(5, 400),
    keywordWeight: z.number().min(0).max(1),
    rerankEnabled: z.boolean(),
    rerankCandidates: integer(1, 100),
    resultCount: integer(1, 20),
  })
  .refine(
    (value) =>
      value.vectorOversample >= value.vectorCandidates &&
      value.rerankCandidates >= value.resultCount,
    "候选数量不符合检索上限。",
  );
export const generationSettingsSchema = z
  .strictObject({
    temperature: z.number().min(0).max(2),
    contextChunks: integer(1, 20),
    maxChunksPerDocument: integer(1, 20),
    contextTokenBudget: integer(1000, 16000),
    maxOutputTokens: integer(128, 8192),
  })
  .refine((value) => value.maxChunksPerDocument <= value.contextChunks);
export const appearanceSettingsSchema = z.strictObject({
  theme: z.enum(["system", "light", "dark"]),
  reduceMotion: z.boolean(),
});
const settingsGroups = {
  database: databaseSettingsSchema,
  models: modelSettingsSchema,
  indexing: indexingSettingsSchema,
  retrieval: retrievalSettingsSchema,
  generation: generationSettingsSchema,
  appearance: appearanceSettingsSchema,
};
export const publicSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: integer(1),
  ...settingsGroups,
});
export const settingsUpdateSchema = z.strictObject({
  expectedRevision: integer(1),
  patch: z
    .strictObject(settingsGroups)
    .partial()
    .refine((value) => Object.keys(value).length > 0, "至少更新一个设置组。"),
});
export const secretKindSchema = z.enum([
  "openrouter-api-key",
  "cohere-api-key",
  "database-password",
]);
export const secretStatusSchema = z.strictObject({
  "openrouter-api-key": z.strictObject({
    configured: z.boolean(),
    persistence: z.enum(["encrypted", "session", "none"]),
  }),
  "cohere-api-key": z.strictObject({
    configured: z.boolean(),
    persistence: z.enum(["encrypted", "session", "none"]),
  }),
  "database-password": z.strictObject({
    configured: z.boolean(),
    persistence: z.enum(["encrypted", "session", "none"]),
  }),
});
export const settingsViewSchema = z.strictObject({
  settings: publicSettingsSchema,
  secrets: secretStatusSchema,
  index: z.strictObject({
    activeGenerationId: uuidSchema.nullable(),
    requiresReindex: z.boolean(),
  }),
});
export const secretSetSchema = z.strictObject({
  kind: secretKindSchema,
  value: text(4096),
  persistence: z.enum(["encrypted", "session"]),
});
export const connectionTargetSchema = z.enum(["database", "openrouter", "cohere"]);
export const connectionReportSchema = z.strictObject({
  target: connectionTargetSchema,
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  message: text(300),
  versions: z
    .strictObject({ postgresql: text(80).optional(), pgvector: text(80).optional() })
    .optional(),
});
export const chatModelInfoSchema = z.strictObject({
  id: text(200),
  name: text(200),
  contextLength: integer(1).nullable(),
  maxOutputTokens: integer(1).nullable(),
  supportsTemperature: z.boolean().nullable(),
});
export const indexStatusSchema = z.strictObject({
  activeGenerationId: uuidSchema.nullable(),
  buildingGenerationId: uuidSchema.nullable(),
  documentCount: integer(0),
  chunkCount: integer(0),
  pendingCount: integer(0),
  failedCount: integer(0),
  requiresReindex: z.boolean(),
  lastErrorCode: apiErrorCodeSchema.nullable(),
});
export const appInfoSchema = z.strictObject({
  apiVersion: z.literal(1),
  name: text(100),
  productName: text(100),
  version: text(40),
  platform: text(30),
  arch: text(30),
  versions: z.strictObject({ electron: text(40), chrome: text(40), node: text(40) }),
  developer: z.strictObject({
    name: text(120).nullable(),
    homepage: z.url().nullable(),
    repository: z.url().nullable(),
    support: z.string().max(200).nullable(),
    license: text(40),
    copyright: text(200).nullable(),
  }),
  mode: z.enum(["desktop", "demo"]),
});
export const citationSchema = z
  .strictObject({
    chunkId: uuidSchema,
    documentId: uuidSchema,
    documentRevision: integer(1),
    title: text(120),
    startLine: integer(1),
    endLine: integer(1),
  })
  .refine((value) => value.endLine >= value.startLine);
export const assistantStartSchema = z.strictObject({
  question: text(4000),
  filters: searchFiltersSchema.optional(),
});
export const operationAcceptedSchema = z.strictObject({ operationId: uuidSchema });
export const operationPayloadSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("started"), kind: z.enum(["assistant", "reindex"]) }),
  z.strictObject({ type: z.literal("retrieving") }),
  z.strictObject({
    type: z.literal("context"),
    search: searchResponseSchema,
    citations: z.array(citationSchema).max(20),
  }),
  z.strictObject({
    type: z.literal("delta"),
    text: z.string().refine((value) => utf8Bytes(value) <= LIMITS.deltaBytes),
  }),
  z
    .strictObject({
      type: z.literal("progress"),
      completed: integer(0),
      total: integer(0),
      failed: integer(0),
    })
    .refine((value) => value.completed + value.failed <= value.total),
  z.strictObject({
    type: z.literal("completed"),
    text: z
      .string()
      .refine((value) => utf8Bytes(value) <= LIMITS.documentBytes)
      .optional(),
    citations: z.array(citationSchema).max(20).optional(),
  }),
  z.strictObject({ type: z.literal("failed"), error: publicErrorSchema.omit({ field: true }) }),
  z.strictObject({ type: z.literal("cancelled") }),
]);
export const operationEventSchema = z.strictObject({
  operationId: uuidSchema,
  seq: integer(1),
  payload: operationPayloadSchema,
});
export const pickedTextFilesSchema = z.strictObject({
  files: z
    .array(
      z.strictObject({
        name: text(255),
        content: z.string().refine((value) => utf8Bytes(value) <= LIMITS.documentBytes),
      }),
    )
    .max(LIMITS.importCount),
});

export const requestSchemas = {
  "system:get-info": commandSchema(empty),
  "system:open-external": commandSchema(z.strictObject({ url: text(2048) })),
  "system:pick-text-files": commandSchema(empty),
  "collections:list": commandSchema(empty),
  "collections:save": commandSchema(collectionSaveSchema),
  "collections:remove": commandSchema(z.strictObject({ id: uuidSchema })),
  "documents:list": commandSchema(listDocumentsSchema),
  "documents:get": commandSchema(z.strictObject({ id: uuidSchema })),
  "documents:save": commandSchema(saveDocumentSchema),
  "documents:set-favorite": commandSchema(documentMutationSchema.extend({ favorite: z.boolean() })),
  "documents:remove": commandSchema(documentMutationSchema),
  "documents:restore": commandSchema(documentMutationSchema),
  "documents:import": commandSchema(batchImportSchema),
  "search:query": searchRequestSchema,
  "search:cancel": commandSchema(z.strictObject({ requestIdToCancel: uuidSchema })),
  "settings:get": commandSchema(empty),
  "settings:update": commandSchema(settingsUpdateSchema),
  "secrets:set": commandSchema(secretSetSchema),
  "secrets:delete": commandSchema(z.strictObject({ kind: secretKindSchema })),
  "connections:test": commandSchema(z.strictObject({ target: connectionTargetSchema })),
  "models:list": commandSchema(empty),
  "index:status": commandSchema(empty),
  "index:rebuild": commandSchema(empty),
  "assistant:start": commandSchema(assistantStartSchema),
  "operations:cancel": commandSchema(z.strictObject({ operationId: uuidSchema })),
} as const;
const cancelled = z.strictObject({ cancelled: z.boolean() });
export const responseSchemas = {
  "system:get-info": appInfoSchema,
  "system:open-external": z.strictObject({ opened: z.literal(true) }),
  "system:pick-text-files": pickedTextFilesSchema,
  "collections:list": z.array(collectionSchema).max(10000),
  "collections:save": collectionSchema,
  "collections:remove": z.strictObject({ removed: z.literal(true) }),
  "documents:list": documentPageSchema,
  "documents:get": documentSchema,
  "documents:save": documentSchema,
  "documents:set-favorite": documentSchema,
  "documents:remove": documentSchema,
  "documents:restore": documentSchema,
  "documents:import": importReportSchema,
  "search:query": searchResponseSchema,
  "search:cancel": cancelled,
  "settings:get": settingsViewSchema,
  "settings:update": settingsViewSchema,
  "secrets:set": secretStatusSchema,
  "secrets:delete": secretStatusSchema,
  "connections:test": connectionReportSchema,
  "models:list": z.array(chatModelInfoSchema).max(10000),
  "index:status": indexStatusSchema,
  "index:rebuild": operationAcceptedSchema,
  "assistant:start": operationAcceptedSchema,
  "operations:cancel": cancelled,
} as const;

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type PublicError = z.infer<typeof publicErrorSchema>;
export type ApiResult<T> =
  { ok: true; value: T; requestId: string } | { ok: false; error: PublicError; requestId: string };
export type Command<T> = { requestId: string; payload: T };
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionSave = z.infer<typeof collectionSaveSchema>;
export type Document = z.infer<typeof documentSchema>;
export type DocumentDraft = z.infer<typeof documentDraftSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type DocumentPage = z.infer<typeof documentPageSchema>;
export type SaveDocument = z.infer<typeof saveDocumentSchema>;
export type DocumentMutation = z.infer<typeof documentMutationSchema>;
export type ListDocuments = z.infer<typeof listDocumentsSchema>;
export type BatchImport = z.infer<typeof batchImportSchema>;
export type ImportReport = z.infer<typeof importReportSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchWarning = z.infer<typeof searchWarningSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type PublicSettings = z.infer<typeof publicSettingsSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type SettingsView = z.infer<typeof settingsViewSchema>;
export type SecretKind = z.infer<typeof secretKindSchema>;
export type SecretStatus = z.infer<typeof secretStatusSchema>;
export type SecretSet = z.infer<typeof secretSetSchema>;
export type ConnectionTarget = z.infer<typeof connectionTargetSchema>;
export type ConnectionReport = z.infer<typeof connectionReportSchema>;
export type ChatModelInfo = z.infer<typeof chatModelInfoSchema>;
export type IndexStatus = z.infer<typeof indexStatusSchema>;
export type AppInfo = z.infer<typeof appInfoSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type AssistantStart = z.infer<typeof assistantStartSchema>;
export type OperationAccepted = z.infer<typeof operationAcceptedSchema>;
export type OperationPayload = z.infer<typeof operationPayloadSchema>;
export type OperationEvent = z.infer<typeof operationEventSchema>;
export type PickedTextFiles = z.infer<typeof pickedTextFilesSchema>;
export type IpcChannel = keyof typeof requestSchemas;
export type RequestFor<C extends IpcChannel> = z.input<(typeof requestSchemas)[C]>;
export type ParsedRequestFor<C extends IpcChannel> = z.output<(typeof requestSchemas)[C]>;
export type ResponseFor<C extends IpcChannel> = z.output<(typeof responseSchemas)[C]>;

export const DEFAULT_SETTINGS: PublicSettings = {
  schemaVersion: 1,
  revision: 1,
  database: { host: "127.0.0.1", port: 5432, database: "zhiyu", user: "zhiyu", sslMode: "disable" },
  models: {
    chatModel: null,
    embeddingModel: "openai/text-embedding-3-large",
    embeddingDimensions: 3072,
    rerankModel: "rerank-v3.5",
  },
  indexing: { chunkTokens: 800, overlapTokens: 120 },
  retrieval: {
    keywordCandidates: 40,
    vectorCandidates: 40,
    vectorOversample: 80,
    keywordWeight: 0.5,
    rerankEnabled: true,
    rerankCandidates: 50,
    resultCount: 8,
  },
  generation: {
    temperature: 0.2,
    contextChunks: 6,
    maxChunksPerDocument: 3,
    contextTokenBudget: 6000,
    maxOutputTokens: 1024,
  },
  appearance: { theme: "system", reduceMotion: false },
};
