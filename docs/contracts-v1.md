# 跨层契约 v1

日期：2026-10-16。本文冻结三路并行开发的 API、数据形态、默认值和语义。它是设计规范，尚不是实现代码。Agent B 将这些定义落实到 `src/lib/contracts/` 的 TypeScript 与运行时 schema；A、C 不各自复制一套正式类型。

## 1. 传输与统一返回

所有日期为 ISO 8601 UTC 字符串，业务 id / requestId / operationId 为 UUID 字符串，revision 是从 1 开始的整数。offset 以行号而非字节表示，行号从 1 开始。JSON DTO 不含 Date、Error、函数、AbortSignal、Map、Buffer 或 SDK 对象。API version 固定为 1。

```ts
export type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE"
  | "SCHEMA_MISMATCH"
  | "CONFIG_REQUIRED"
  | "PROVIDER_AUTH"
  | "PROVIDER_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_UNSUPPORTED"
  | "INDEX_NOT_READY"
  | "CANCELLED"
  | "TIMEOUT"
  | "ENCRYPTION_UNAVAILABLE"
  | "INTERNAL";

export type ApiResult<T> =
  | { ok: true; value: T; requestId: string }
  | {
      ok: false;
      error: {
        code: ApiErrorCode;
        message: string;
        retryable: boolean;
        field?: string;
      };
      requestId: string;
    };

export type Command<T> = { requestId: string; payload: T };
```

边界校验失败也返回结构化错误，不泄漏 SQL、路径、密码和堆栈。基础传输异常由 renderer adapter 映射为可读错误，不能把所有错误都吞成空结果。错误 field 只接受 schema 中的公开字段名。

## 2. 文档、分类和导入

```ts
export type Collection = { id: string; name: string; sortOrder: number };
export type Document = {
  id: string;
  collectionId: string | null;
  title: string;
  contentMarkdown: string;
  tags: string[];
  favorite: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type DocumentDraft = Pick<Document, "title" | "contentMarkdown" | "collectionId" | "tags">;
export type SaveDocument = {
  draft: DocumentDraft;
  existing?: { id: string; expectedRevision: number };
};
export type DocumentSummary = Omit<Document, "contentMarkdown"> & { excerpt: string };
export type ListDocuments = {
  collectionId?: string;
  tag?: string;
  view: "all" | "favorites" | "recent" | "trash";
  offset: number;
  limit: number;
};
export type DocumentPage = { items: DocumentSummary[]; total: number };
export type DocumentMutation = { id: string; expectedRevision: number };
export type BatchImport = {
  sourceFingerprint: string;
  items: Array<{ sourceId: string; draft: DocumentDraft }>;
};
export type ImportReport = { imported: number; skipped: number; documentIds: string[] };
```

删除是软删除，恢复也使用 revision；不存在/已删除项的修改有明确错误。收藏使用 `setFavorite({ id, expectedRevision, favorite })`，避免重试导致 toggle 两次。MVP 不提供永久清空。

标题去空白后 1–120 字符，正文最多 2 MiB UTF-8，标签最多 12 个且每个 1–32 字符，trim 去重。列表 limit 默认 50、范围 1–100，offset ≥ 0；完整笔记由 `documents.get` 单独读取。分类 id 必须存在，初始迁移插入原型三类，用户可重命名和新建；删除分类时文档设为 null。

旧原型中的 `content` 映射为 `contentMarkdown`、`collectionId` 映射已有分类，`zhiyu:notes:v1` 在 C 的迁移 UI 读取并校验。`sourceFingerprint` 由源标识和规范化内容 hash 组成，重复导入返回 skipped，不重复创建。API 不接受磁盘任意路径；文件由 B 的原生选择器读取并经大小、编码、扩展名验证，返回限定的文本 DTO。

## 3. 搜索与可解释降级

```ts
export type SearchRequest = {
  requestId: string;
  query: string;
  filters?: { collectionId?: string; tags?: string[]; favoriteOnly?: boolean };
  resultCount?: number;
};
export type SearchHit = {
  chunkId: string;
  documentId: string;
  documentRevision: number;
  title: string;
  snippet: string;
  startLine: number;
  endLine: number;
  updatedAt: string;
  scores: {
    keywordRank?: number;
    vectorRank?: number;
    vectorCosine?: number;
    rrf: number;
    rerank?: number;
  };
};
export type SearchWarning = {
  stage: "keyword" | "embedding" | "vector" | "rerank";
  reason: "not-configured" | "disabled" | "index-pending" | "failed" | "timeout";
  message: string;
};
export type SearchResponse = {
  requestId: string;
  mode: "hybrid-rerank" | "hybrid" | "keyword" | "vector";
  generationId: string | null;
  hits: SearchHit[];
  warnings: SearchWarning[];
  timingsMs: {
    keyword?: number;
    embedding?: number;
    vector?: number;
    fusion?: number;
    rerank?: number;
    total: number;
  };
};
```

搜索返回的是片段，不能把 `hits.length` 标成“笔记数量”。无片段仍为成功空数组；无数据库为错误。snippet 是有限长纯文本（默认最多 1600 Unicode 字符），不在 UI 直接当 HTML 渲染。送 Rerank 的内容来自完整且受 token 上限约束的 chunk，不从截断的 UI snippet 反推。

query trim 后 1–2000 Unicode 字符，resultCount 1–20，tags 最多 12 个。请求前 UI debounce，`search.cancel({ requestId })` 取消该调用；每窗口默认最多 1 个在途主动查询，新 requestId 不得接受旧响应。取消仅限当前 sender 拥有的请求。内部服务可以接收 AbortSignal，但该对象不进入 IPC。

## 4. 设置与默认值

```ts
export type PublicSettings = {
  schemaVersion: 1;
  revision: number;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    sslMode: "disable" | "verify-full";
  };
  models: {
    chatModel: string | null;
    embeddingModel: "openai/text-embedding-3-large";
    embeddingDimensions: 1536 | 3072;
    rerankModel: "rerank-v3.5";
  };
  indexing: { chunkTokens: number; overlapTokens: number };
  retrieval: {
    keywordCandidates: number;
    vectorCandidates: number;
    vectorOversample: number;
    keywordWeight: number;
    rerankEnabled: boolean;
    rerankCandidates: number;
    resultCount: number;
  };
  generation: {
    temperature: number;
    contextChunks: number;
    maxChunksPerDocument: number;
    contextTokenBudget: number;
    maxOutputTokens: number;
  };
  appearance: { theme: "system" | "light" | "dark"; reduceMotion: boolean };
};
export type SecretKind = "openrouter-api-key" | "cohere-api-key" | "database-password";
export type SecretStatus = Record<
  SecretKind,
  { configured: boolean; persistence: "encrypted" | "session" | "none" }
>;
export type SettingsView = {
  settings: PublicSettings;
  secrets: SecretStatus;
  index: { activeGenerationId: string | null; requiresReindex: boolean };
};
export type SettingsUpdate = {
  expectedRevision: number;
  patch: Partial<
    Pick<
      PublicSettings,
      "database" | "models" | "indexing" | "retrieval" | "generation" | "appearance"
    >
  >;
};
```

patch 以组为单位替换，存在的组必须提供该组所有字段；顶层不存在的组保留。schema 拒绝未知字段，主进程不使用无校验深合并。v1 UI 允许选择聊天模型、embedding 维度和启停 Rerank；embedding/Rerank 模型标识锁定上述用户指定模型，未来扩展需更新版本与索引策略。

| 字段                                 | 默认                                                                | 范围/约束                                                          | 是否重建             |
| ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------- |
| database                             | `127.0.0.1:5432`，database `zhiyu`，user `zhiyu`，sslMode `disable` | host 无协议/路径/凭据；非 loopback 要 verify-full；不自动建角色/库 | 切换连接后检测目标库 |
| models.chatModel                     | null                                                                | 选择 OpenRouter 实际可用 ID 后才能生成                             | 否                   |
| embeddingModel                       | `openai/text-embedding-3-large`                                     | v1 固定                                                            | 未来变更需重建       |
| embeddingDimensions                  | 3072                                                                | 3072 / 1536；先验证路由支持                                        | 是                   |
| rerankModel                          | `rerank-v3.5`                                                       | v1 固定，失败不静默换型号                                          | 否                   |
| chunkTokens / overlapTokens          | 800 / 120                                                           | chunk 200–2000，overlap 0–400 且 < chunk/2                         | 是                   |
| keywordCandidates / vectorCandidates | 40 / 40                                                             | 各 5–100                                                           | 否                   |
| vectorOversample                     | 80                                                                  | ≥ vectorCandidates、≤ 400                                          | 否                   |
| keywordWeight                        | 0.5                                                                 | 0–1，vectorWeight = 1 - keywordWeight                              | 否                   |
| rerankEnabled                        | true                                                                | 无 key 时返回降级状态                                              | 否                   |
| rerankCandidates                     | 50                                                                  | resultCount–100；实际取 min(候选数, 设置值)                        | 否                   |
| resultCount                          | 8                                                                   | 1–20，≤ rerankCandidates                                           | 否                   |
| temperature                          | 0.2                                                                 | 0–2，并且满足选中模型能力；不支持则省略                            | 否                   |
| contextChunks / maxChunksPerDocument | 6 / 3                                                               | 1–20 / 1–contextChunks                                             | 否                   |
| contextTokenBudget                   | 6000                                                                | 1000–16000，还要满足模型总窗口预算                                 | 否                   |
| maxOutputTokens                      | 1024                                                                | 128–8192，还要满足模型能力                                         | 否                   |
| theme / reduceMotion                 | system / false                                                      | 系统 reduced motion 始终优先                                       | 否                   |

连接、聊天模型能力、公开模型列表由 B 提供平台入口，读取 provider 的适配器由 A 提供；涉及网络和凭据的操作都在主进程。模型列表失败保留当前选值，并可手填 ID 后验证；不把未核实能力标为支持。

settings update 成功返回完整 `SettingsView` 和 `requiresReindex`；不能自动收费重建。`index.rebuild` 在 UI 展示估计文档/片段量后触发。普通检索/生成不接受任意 settings 对象，只使用已验证快照，防止 UI 绕过上限。

`secrets.set({ kind, value, persistence: 'encrypted' | 'session' })` trim 校验、长度 1–4096，成功返回 SecretStatus；`secrets.delete({ kind })` 返回 SecretStatus。密钥输入可以临时存在 Renderer 的输入状态，提交/关闭后清空；不得自动填回、写 localStorage 或记录输入。数据库无密码属于显式配置，不把空字符串当已配置 secret。

## 5. 助手与索引操作事件

```ts
export type OperationAccepted = { operationId: string };
export type AssistantStart = { question: string; filters?: SearchRequest["filters"] };
export type Citation = {
  chunkId: string;
  documentId: string;
  documentRevision: number;
  title: string;
  startLine: number;
  endLine: number;
};
export type OperationPayload =
  | { type: "started"; kind: "assistant" | "reindex" }
  | { type: "retrieving" }
  | { type: "context"; search: SearchResponse; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "progress"; completed: number; total: number; failed: number }
  | { type: "completed"; text?: string; citations?: Citation[] }
  | { type: "failed"; error: { code: ApiErrorCode; message: string; retryable: boolean } }
  | { type: "cancelled" };
export type OperationEvent = { operationId: string; seq: number; payload: OperationPayload };
```

UI 先用 UUID 创建 Command.requestId 并登记待启动操作，再订阅唯一白名单 `operation:event`，最后 start。主进程校验并将该 requestId 登记为 operationId，返回相同 id；UI 因而可以处理早于 start 响应到达的事件。重复或仍在使用的 id 返回 CONFLICT，owner 由主进程从 sender 推导，不能由 Renderer 指定。每操作 seq 从 1 递增且恰有一个终态，未知 operation 事件不更新当前面板。delta 文本节流到最多每秒 20 次发送、每事件最多 16 KiB，避免 IPC 队列失控。

主进程按 webContents/frame 存储拥有者，禁止另一个窗口取消或订阅其任务；窗口关闭立即取消。`operations.cancel({ operationId })` 幂等。重建任务取消不清除 active 索引；应用重启后持久化任务可恢复。

首版每窗口最多 1 个助手生成，整个应用最多 1 个 generation rebuild。`question` 1–4000 Unicode 字符，不接受用户从 renderer 注入 system prompt、provider URL 或任意工具。

## 6. 公开客户端与 IPC 方法

`window.desktop` 和浏览器 demo adapter 共同实现 `KnowledgeClient`。下表每项除事件订阅外返回 `Promise<ApiResult<T>>`；参数是 `Command<Payload>`，特别注明的 search 使用 SearchRequest 本身（已有 requestId）。不再保留任意 IPC invoke 通道。

| 客户端方法              | 固定 IPC channel         | Payload / 结果                                                  |
| ----------------------- | ------------------------ | --------------------------------------------------------------- |
| `system.getInfo`        | `system:get-info`        | `{}` / AppInfo                                                  |
| `system.openExternal`   | `system:open-external`   | `{url}` / `{opened:true}`；仅经许可 http(s)                     |
| `system.pickTextFiles`  | `system:pick-text-files` | `{}` / `{files: {name,content}[]}`；受导入数量/总量限制         |
| `collections.list`      | `collections:list`       | `{}` / Collection[]                                             |
| `collections.save`      | `collections:save`       | `{id?,name,sortOrder}` / Collection                             |
| `collections.remove`    | `collections:remove`     | `{id}` / `{removed:true}`                                       |
| `documents.list`        | `documents:list`         | ListDocuments / DocumentPage                                    |
| `documents.get`         | `documents:get`          | `{id}` / Document                                               |
| `documents.save`        | `documents:save`         | SaveDocument / Document                                         |
| `documents.setFavorite` | `documents:set-favorite` | DocumentMutation + favorite / Document                          |
| `documents.remove`      | `documents:remove`       | DocumentMutation / Document（含 deletedAt）                     |
| `documents.restore`     | `documents:restore`      | DocumentMutation / Document                                     |
| `documents.import`      | `documents:import`       | BatchImport / ImportReport                                      |
| `search.query`          | `search:query`           | SearchRequest / SearchResponse                                  |
| `search.cancel`         | `search:cancel`          | `{requestIdToCancel}` / `{cancelled:boolean}`                   |
| `settings.get`          | `settings:get`           | `{}` / SettingsView                                             |
| `settings.update`       | `settings:update`        | SettingsUpdate / SettingsView                                   |
| `secrets.set`           | `secrets:set`            | kind/value/persistence / SecretStatus                           |
| `secrets.delete`        | `secrets:delete`         | `{kind}` / SecretStatus                                         |
| `connections.test`      | `connections:test`       | `{target}`（database / openrouter / cohere） / ConnectionReport |
| `models.list`           | `models:list`            | `{}` / ChatModelInfo[]                                          |
| `index.status`          | `index:status`           | `{}` / IndexStatus                                              |
| `index.rebuild`         | `index:rebuild`          | `{}` / OperationAccepted                                        |
| `assistant.start`       | `assistant:start`        | AssistantStart / OperationAccepted                              |
| `operations.cancel`     | `operations:cancel`      | `{operationId}` / `{cancelled:boolean}`                         |
| `operations.subscribe`  | `operation:event`        | `(listener) => unsubscribe`；只暴露经过 schema 验证的事件       |

AppInfo 至少有 apiVersion、name、productName、version、platform、arch、Electron/Chrome/Node 版本、public developer 信息和运行模式 `desktop/demo`。开发者信息来自公共配置，不能包含本机用户名或路径。

ConnectionReport 为 `{target,ok,latencyMs,message,versions?}`，失败不含密码/DSN/provider 原始响应。连接测试默认做数据库只读健康检查和 provider 轻量鉴权；需要付费样本的 embedding/Rerank 探测单独在 UI 明示并由用户点击，不因打开设置页自动付费。

ChatModelInfo 为 `{id,name,contextLength:number|null,maxOutputTokens:number|null,supportsTemperature:boolean|null}`；unknown 不伪造为 true。IndexStatus 包含 active/building generation、文档/片段/待处理/失败数量、requiresReindex 和最后错误代码，不返回数据库内部路径。

保留旧 `app:get-info` 作为只读兼容入口直到原型测试迁移完成，由 B 负责移除时机；UI 不再新增对旧接口的依赖。

## 7. A 服务与 B 平台的注入边界

A 导出 `electron/services/knowledge/index.ts` 的 `createKnowledgeService(deps)`。服务不 import Electron，不读取全局环境变量/磁盘设置文件，不决定 BrowserWindow 或 IPC。B 在 composition 调用它，提供：

- `getSettings(): PublicSettings`：当前验证过的只读快照。
- `readSecret(kind): Promise<string | null>`：仅主进程内部使用，不进入公共 DTO。
- `emit(ownerId, event): void`：B 负责事件归属、传输和节流。
- `logger`：脱敏结构化日志；可测 `now()` 与 `createId()`。

服务导出 typed collections/documents/search、models/connection probe、index、assistant、`applySettings(previous,next)`、`dispose()`。取消 registry 只由 B 维护，A 服从注入的 signal，不再建第二套 owner/operation registry。B 保留 settings/secrets/system 方法，收到配置更改后调用 applySettings 重新建连接池或触发 requiresReindex 检测；不能直接修改 A 的 SQL 实现。

内部方法接收 `{ownerId, signal}` 上下文，该信号从 B 的 cancellation registry 产生。长操作的 id 由 B 按已校验的 Command.requestId 先注册，然后将 id 与受控上下文传给 A。服务测试用 fake settings/secrets/provider，不需要启动 Electron。

## 8. 版本与变更纪律

B 实现的公共 schema 必须与本文一致；未确定的附属字段在 M0 一次补齐并告知 A/C。之后任何不兼容变化先在文档写清差异和迁移，再由 B 更新共享类型及 fixture，同时验证两个消费者。

不得为避免联调而使用 `any`、unknown[]、万能 JSON 字段或静默忽略未实现方法。可用实现明确的 demo adapter 和 provider mock 支持并行，运行模式必须可识别，不能把 demo 搜索标记为真实 Rerank。

## 9. M0 精确类型入口（Agent B）

正式入口为 `src/lib/contracts/index.ts`：导出所有 DTO、`KnowledgeClient`、`requestSchemas`、`responseSchemas`、`operationEventSchema`、`DEFAULT_SETTINGS`。schema 拒绝未知字段，patch 按完整组替换。`src/lib/desktop.ts` 声明 `window.desktop`，保留旧 `getInfo()` 只读兼容方法。

补齐的附属字段如下，A/C 共用，不再单独推断：

- `AppInfo.versions = { electron, chrome, node }`；`developer = { name, homepage, repository, support, license, copyright }`，未知资料为 null；`mode` 为 desktop/demo。
- `IndexStatus = { activeGenerationId, buildingGenerationId, documentCount, chunkCount, pendingCount, failedCount, requiresReindex, lastErrorCode }`；generation ID 和 lastErrorCode 可为 null。
- `ConnectionReport.versions?: { postgresql?: string, pgvector?: string }`，不接受 provider 原始对象。
- `KnowledgeService` / `KnowledgeServiceDependencies` / `KnowledgeServiceFactory` 见 `src/lib/contracts/service.ts`。普通方法返回 DTO 或抛出带公开 code 的错误，由 B 转 `ApiResult`；取消上下文是 `{ ownerId, signal }`。
- `index.rebuild(context)` / `assistant.start(input, context)` 返回 `Promise<void>`；context 增加 `{ operationId, emit(payload) }`。B 生成 started/终态和 seq，A 只发送 retrieving/context/delta/progress。B 的 `deps.emit(ownerId, event)` 兼容事件 sink 同样经过 owner、schema 和 seq 校验，不能直接发送给任意窗口。

测试入口 `npm test` 动态发现 domain/search/contracts/platform 下的 `.test.ts`；数据库与 live eval 分组独立，缺配置或没有用例时退出非零并明确标为未执行。Electron 主进程与 preload 由 esbuild 分别 bundle，`tsc --noEmit` 覆盖全部嵌套 Electron 源文件和共享契约。
