# Agent A · 数据与检索交付

工作分支：`feat/data-retrieval`。工作区：`D:\Warp\zhiyu-a-data`。由 CTO 选择阶段提交合并；不推送远程、不自动合入主分支。已合入公共 M0：`34157d2`，保留已有历史。

## 当前完成范围

这是一组可审查的数据层阶段交付，完整知识服务尚未接通。

- `src/lib/domain/`：共享 schema 驱动的标题/标签/正文/revision 校验、写入与查询一致的中文词项、字面通配符转义与短词计划、Markdown 结构优先的分块核心、RRF、provider 响应校验、引用白名单与上下文限额。
- `electron/services/knowledge/database/`：SQL 端口、版本/checksum 迁移器、事务与脱敏错误、typed documents/collections 仓储。
- `database/postgres.ts` 提供注入配置/密码的受限 pg 连接池；`indexing/writer.ts` 作为仓储 `onRevision`，同事务生成 token 分块、带权 FTS 和 pending job。`retrieval/postgres.ts` 提供两路参数化 SQL、统一过滤及来源复核。
- `db/`：完整 generations/chunks/embeddings/jobs/imports 的版本 SQL、3072 halfvec 与 1536 vector HNSW 索引、默认三分类，以及初始化/备份/迁移/回滚说明。
- `tests/domain/`：领域、迁移控制流、随机 schema 与仓储行为测试。`tests/integration/test-schema.ts` 提供只清理自己创建的随机 schema 的助手。
- `electron/services/knowledge/retrieval/hybrid.ts`：`createHybridSearch(ports)`，关键词与 query embedding 并行、active profile 查询、稳定 RRF、最多 50 个 Rerank 候选、失败降级及来源 revision 前后复核。SQL 召回端口尚未接通。
- `electron/services/knowledge/providers/cohere.ts`：可注入 fetch 的真实 Cohere v2 HTTP adapter，固定 `rerank-v3.5`，校验 `top_n` 与响应 index，鉴权不重试，429/短暂 5xx/网络最多重试两次。总预算覆盖请求、响应体和退避，取消不依赖 provider 遵守 signal。尚未调用真实 API。
- `providers/openrouter.ts`：LangChain `Embeddings` 兼容 adapter，固定 OpenRouter large3 endpoint/model，显式传维度，响应按 index 复原。默认每批最多 16 段/8192 token、并发 2，最多 2 次显式重试，所有实际请求经过预算钩子；批次失败取消其余请求。
- `indexing/worker.ts`：持久化租约、`SKIP LOCKED` 领取、网络在事务外、每批条件写回、配置/版本/内容缓存、取消释放和过期租约恢复；每任务最多领取 5 次。部分成功保留，后续只补缺失向量。`003_embedding_cache.sql` 新增缓存查找索引，不改写已发布迁移。

仓储暴露 `createPersistence({pool, now, createId, onRevision})`，返回公共 `KnowledgeService` 的 documents/collections 部分。保存、收藏、删除、恢复与批量导入在事务中执行；revision 更新后必须调用 `onRevision(connection, document, context)`，该必需回调供 A 的索引模块在同一事务保存 chunks/FTS/jobs，失败时整笔回滚。回调不得执行 provider 网络调用。

分类删除采用数据库 `ON DELETE SET NULL`。列表在只读 repeatable-read 事务中返回分页结果和总数；导入按 fingerprint 使用 advisory lock，并持久化每条来源到文档的映射。原型分类 UUID 映射见 [数据库说明](../db/README.md)，待 CTO/B/C 同步。

分词仅用于中文 FTS，不能替代模型 tokenizer。生产分块使用 `js-tiktoken@1.0.21` 的 `cl100k_base`，已验证中英文已知 token 数、特殊标记作为普通文本、真实 token 上限与 overlap。ICU 升级可能改变词边界，应重新评估 normalizer/index profile。

## 阶段与验证

1. `1f400c1`：领域准备，严格 TypeScript 编译与 11/11 项领域行为测试通过。
2. `7923e15`：版本迁移与 schema 隔离准备，新增 8/8 项离线测试通过；数据库 SQL 仍未实测。
3. M0 后的仓储阶段：新增 4/4 项针对输入规范化、参数化正文、并发 revision、删除状态、索引失败回滚和分类校验的离线行为测试通过；共享输入范围与公共类型直接复用 M0。
4. `d41baec`：provider 未知 JSON 的结构、float32/nonzero 向量与精确 Rerank 数量校验；隔离 schema 在回调遗留事务时先回滚再清理，保留业务和清理错误。
5. 混合检索与 Cohere 阶段：13/13 项专项测试通过，覆盖并行、过滤透传、active/目标维度不同、无 key、重复 index、降级、来源失效、候选上限、取消、超时及每次重试预算。
6. PostgreSQL 召回与事务索引基线：真实 tokenizer、配置 fingerprint/缓存键、pg pool、同事务 chunks/FTS/jobs、参数化双路召回和来源复核。写入先取 generation 共享 advisory lock，再取文档行锁；切换流程必须按同样顺序取独占锁。

M0 前只读使用原目录已有编译器，输出均写入本 worktree 忽略目录；M0 后使用本 worktree 独立的 node_modules、`.cache` 与 `.next`。离线迁移测试已移入 domain 组，避免被 `test:db` 当作真实数据库证据。

2026-10-16 已顺序执行并通过 `npm run check`、`npm test`（35/35 项）、`npm run build`（Next 静态导出与 Electron bundle）。`npm run test:db` 实际退出码为 2，原因是未提供专用 `TEST_DATABASE_URL`，不计为通过。当前 bundle 仍是 M0 原型入口，构建成功不代表仓储已经接到 IPC。

混合检索/Cohere 阶段再次顺序通过 `npm run check` → `npm test`（51/51 项）→ `npm run build`。未改 UI/IPC，不涉及 browser/desktop 接线验收。CTO 在 `main` 的 `docs/integration-status.md` 已记录其隔离 PostgreSQL 17.6 / pgvector 0.8.6 和 SQL 级验收；该结果不替代本分支尚待执行的仓储/worker 集成测试。

当前的离线 SQL 端口替身只验证控制流，不能证明 PostgreSQL 的真实回滚、FTS、索引或执行计划通过。

SQL 召回阶段在本分支顺序通过 `npm run check` → `npm test`（112/112）→ `npm run build`，随后 `npm run test:db` 的 3 项真实集成测试通过（包含生产 pg adapter、迁移/CRUD/回滚/FTS/过滤/3072 索引计划）。测试仅使用 CTO 提供的隔离实例和本次生成的随机 schema；没有真实 provider 调用。平台组合根仍未注入 A 的完整服务。

embedding/worker 阶段顺序通过 `npm run check` → `npm test`（116/116）→ `npm run build`；真实数据库组 7/7 通过，新增缓存复用、修改/删除期间拒绝旧响应、部分成功后重启补缺、过期租约恢复、取消与维度错误的持久化验证。OpenRouter HTTP 全部为合成 mock；尚无真实路由/付费用量结论。

generation 阶段新增 `indexing/manager.ts`：旧 active 持续查询，短事务补齐 building 当前 revision，独占 catalog advisory lock 内核对所有文档/任务/向量后原子切换；失败或取消保留旧 active。后台与前台重建共享 worker，每实例最多两个在途任务。`recover` 补齐重启遗留 building，并在就绪后完成切换。新增三项真实数据库测试验证 3072→1536、重建中编辑、取消/认证失败和重启恢复，全部通过。本工作区随后顺序 check、128 项离线测试、build 与 12 项真实数据库测试通过；后两组的新增助手/工厂文件在各自后续阶段提交，网络均为合成替身。

助手阶段提供模型目录与免费鉴权探测、LangChain ChatOpenAI 流、完整 chunk 上下文、跨 delta 引用编号白名单、token/每文档预算及来源 revision 复核。聊天模型未选择则拒绝生成，无证据直接返回中文“资料不足”。温度仅在目录明确支持时传递；未知能力为 null。显式隔离 LangChain 回调，测试开启环境 tracing/verbose 时无笔记日志与追踪请求。新增 10 项离线行为/真实 SDK mock HTTP 测试通过，已包含在上述 128 项全量结果中。模型目录和未知 tokenizer 的窗口估算不代表模型路由已验证；聊天 token 采用 cl100k_base 估算，不声称适配任意模型的精确 tokenizer。

## 尚需完成与给 B 的依赖请求

已合入 CTO 发布的 `b7a9b77` 共享依赖/测试基线，版本见 [dependency-baseline.md](dependency-baseline.md)。本 worktree 独立 `npm ci` 成功；A 没有另行修改 package/lockfile。ESM 依赖由 esbuild 打入 CJS 主进程，sandbox preload 不加载它们。

完整 `createKnowledgeService(deps)` 与 live eval 尚未交付；LangChain LLM adapter、知识助手和 generation 重建模块已提供。平台接入仍需后续工厂阶段。B 还需提供迁移 SQL 的打包资源或文本 loader；资源列表现在包括 `003_embedding_cache.sql`。

真实数据库验收需要明确的专用 `TEST_DATABASE_URL`、PostgreSQL >=17、public schema 的 pgvector >=0.8 和 pg_trgm；包括 CRUD/并发/导入/中文 FTS/短词/3072 索引 EXPLAIN/恢复任务/索引切换。应用服务不读取 process.env 或磁盘设置/秘密。

CTO 已提供隔离测试库的显式入口，后续测试仅在各自随机 schema 中运行；当前没有 provider 凭据或真实检索质量、3072/1536 路由能力、provider 用量、live eval 结论。没有自动读取、搜索已有 provider key 或发送私人笔记。
