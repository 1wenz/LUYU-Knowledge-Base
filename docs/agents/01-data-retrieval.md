# Agent A 任务书 · 数据、混合检索与 LangChain

你负责实现知识库的数据和 AI 核心，使 PostgreSQL 中的笔记经过“中文关键词 + large3 向量 → RRF → Cohere Rerank 3.5”返回有来源的片段，并支持知识助手。按本任务书直接推进，实施选择遵循 KISS/DIY，不额外创建自动代理团队。

## 开始前

先读 `AGENTS.md`、`Designlang.md`、`docs/architecture-v1.md`、`docs/contracts-v1.md`、`docs/development-principles.md` 和本目录 README。检查现有原型及 Git 状态，保留用户未提交内容和 Prime Agent 工具。

B 负责发布包含完整源码和公共契约的 M0。M0 到达前可规划迁移、领域算法与测试，不从旧 HEAD 重建整个工程。正式实现在独立 `feat/data-retrieval` worktree，不能改 package/lockfile 或公共 contracts。

## 你的唯一修改范围

- `src/lib/domain/**`：校验、分词/分块、RRF、引用约束、索引 profile 和纯类型端口。
- `electron/services/knowledge/**`：数据库、迁移执行器、job worker、embedding/Rerank/LLM adapters、应用服务。
- `db/**`：版本 SQL、测试/开发数据库说明、无凭据的示例配置源。
- `tests/domain/**`、`tests/search/**`、`tests/integration/**`、`tests/evals/**`。
- `docs/data-retrieval.md`：运行方式、索引设计、数据迁移、eval 和已知边界。

不要修改 Renderer、preload、IPC 注册、秘密文件、根脚本、根配置和其他 agent 的测试。现有 `src/features/knowledge/model.ts` / `repository.ts` 由 C 迁移；新领域逻辑放 `src/lib/domain`，不要和 C 争用旧文件。现有 domain 测试若依赖旧 repository，先保留回归测试，协调 C 迁移外部行为。

## 输入与输出契约

输入来自 B 注入的 PublicSettings、只在主进程可读的 secret accessor、取消 signal、ownerId、operationId、脱敏 logger 与事件 sink。不能在本服务读取 `process.env`、`safeStorage`、磁盘设置或导入 Electron。真实 eval runner 可以显式读取其测试环境变量，不能将这个例外带进业务服务。

输出为 `createKnowledgeService(deps)`，公开与契约一致的 documents/collections/search、models/connection probe、index/assistant 实现及 `applySettings/dispose`。B 包装成 IPC，不把 `ApiResult`、SDK Error 或 callback 塞进数据库。服务内部使用类型化领域错误，由 B 映射公开错误。

依赖请求发给 B：`pg`、`@langchain/core`、`@langchain/openai`、`@langchain/textsplitters`、实际需要的 tokenizer 与类型包；说明版本/ESM 要求。Cohere v2 可以用内置 fetch；不要无理由引入大型 community 包或另一套向量数据库。

## A1 · 领域与 PostgreSQL 基线

先编写失败测试，再实现以下行为：

1. 文档标题、标签、正文大小、collection、revision 校验。保存、收藏、删除和恢复有可验证的冲突语义。
2. 版本迁移及 checksum、连接池/超时、参数化 SQL；空库只插入默认分类，不自动填 demo 笔记。
3. documents/collections CRUD、分页和软删除，导入 fingerprint 幂等；事务失败不部分落库。
4. 完整 schema 采用架构中的 generations/chunks/embeddings/jobs。检查 pgvector 版本，不能静默忽略扩展缺失。
5. 专用测试库/schema；默认创建随机 schema，所有 destructive cleanup 限于自己创建的命名空间，拒绝拿用户库清空测试。

检查与提交建议：领域测试、数据库迁移/CRUD 集成、受影响类型检查、diff check，然后 `feat: add postgres knowledge persistence`。将暂不可运行的数据库检查明确记为未执行。

## A2 · 分块、large3 与可恢复索引

1. 中文检索写入/查询共用 Intl.Segmenter 词项规范；FTS 标题/标签权重、字面短语和 1–2 字分支有独立用例。
2. Markdown 结构优先、token-aware 的 800/120 默认分块；保留 source line，代码块超长也要切分。不得用中文字符数冒充 token 数。
3. OpenRouter endpoint 使用 `openai/text-embedding-3-large`，默认 3072 维，LangChain Embeddings adapter；校验 batch 数量、index 映射、长度和有限值。
4. 3072 原向量 + `halfvec(3072)` HNSW 表达式索引，80 内部候选 float32 重排取 40；1536 作为明确验证过的可选 profile。
5. 短事务先保存当前 chunks/FTS 与 job，网络调用在事务外；限制 batch/token/concurrency，缓存键包括配置和版本。
6. revision 条件写入防止慢 embedding 覆盖新笔记；暂停/重启后 job 恢复；日志不出现正文、密码或 API key。

必须测试：中文与英文 token、overlap、超长块、维度不符、响应乱序、部分 batch 失败、429/超时、删除期间响应、重启任务。以实际 `EXPLAIN` 验证查询形态，不能用低维 fake 表替代 3072 索引测试。

阶段提交建议：`feat: add langchain embedding and recoverable indexing`。

## A3 · 混合召回和 Cohere

实现两路过滤一致的搜索。关键词与 query embedding 并行，向量调用在 embedding 后；按 chunk 合并和稳定 RRF 排序，最多 50 候选进入 Cohere。

Cohere 使用 `/v2/rerank`、`rerank-v3.5`、正确的 `top_n`；index 映射必须校验。完整返回 `SearchResponse` 的来源、revision、行号、mode、warnings 与各阶段耗时。零命中不调用 provider。

必须测试：单路/双路、重复 chunk、同分稳定顺序、过滤不泄漏、Cohere 越界/重复 index、无 key、认证错误、限流、取消和时间预算。Rerank 失败返回 RRF；embedding 失败返回当前关键词，UI 的错误码/降级语义不能自创。

重建使用 building generation，旧 active 可查询；写入同时排新旧任务，最终切换带 revision reconciliation 和 advisory lock。新配置尚未激活时，query embedding 仍使用 active profile，不能使用目标维度去查旧索引。取消/失败保留旧索引。

阶段提交建议：`feat: add hybrid retrieval and cohere reranking`。

## A4 · 知识助手与真实 eval

用 LangChain prompt/Runnable + OpenRouter ChatOpenAI 实现两步 RAG。用户选择聊天模型后才能生成；温度默认 0.2，按模型能力透传或省略。上下文 token 预算和每文档片段上限必须生效。

事件遵循契约 seq/终态规则，流式文本不自动重试；引用属于本次提供的 chunk 和 revision。检索内容不能升级为 system 指令，没有证据时说明不足。不实现 shell 工具、任意文件访问或自主多代理。

在 `tests/evals` 准备可提交的中英文合成语料、至少 30 题的质量集和独立 runner。真实网络要求 `RUN_LIVE_EVAL=1`、两家 key 与 `EVAL_DATABASE_URL`，默认 ≤6 provider 请求、重试计入预算；预算或配置缺失给明确失败。普通测试绝不联网收费。

报告 embedding/查询/Rerank/可选回答、维度、用量、耗时、Recall@20/nDCG@8/MRR、三个检索基线。测试输出只能有合成数据和统计，不打印真实 key。没有凭据时完成 runner 与 mock 契约验证并如实说明未跑 live，不把跳过当结果。

阶段提交建议：`feat: add cited knowledge assistant and live eval harness`。

## 交给 B/C 的结果

- 工厂导出、方法签名、错误分类、生命周期、需要的依赖/脚本与精确 commit。
- 数据库初始化/备份/迁移步骤、要求的扩展和测试连接变量，禁止提交真实 `.env`。
- 可供 C 使用的正常/无结果/关键词降级/Rerank 失败/索引进行中示例 DTO。
- 证明笔记更新、过滤、取消、索引重建和回答引用正确的测试证据。

最终验收必须覆盖：新建中文笔记 → FTS 立刻可搜 → embedding 完成 → 语义改写命中 → Rerank 调整顺序 → 引用定位 → 修改后不引用旧 revision → 切维度重建后仍可搜索。各阶段检查后分别本地 commit，不等待整条工作流结束才提交。
