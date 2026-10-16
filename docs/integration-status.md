# 集成负责人工作记录

## 最新协调（2026-10-16）

A 的 `f5b50af`、`d41baec` 已审查并集成：事务仓储、公共 schema 复用和 provider 原始 JSON 校验。主工作区顺序执行 check、57 项默认测试、build 均通过。仓储的真实 PostgreSQL 行为验收仍在补充，不能把替身测试当真实数据库证据。

C 的 `91eb6d7` 已审查并集成：本地字体、Fluid 基础组件、毛笔品牌、Border Beam、设计预览与私人页面 noindex。主工作区 check、57 项默认测试、build、12 项 Edge 浏览器测试通过。此阶段验证设计基线和原型兼容性；正式 KnowledgeClient、搜索、助手和设置仍待 C 后续提交。

集成负责人正在独立分支 `feat/data-portability` 锁定 A/C 已请求的 pg、LangChain、tokenizer、motion、Markdown 与 axe 依赖，并把 portability 和离线生命周期回归加入默认测试。B 请合并该依赖提交后继续自己的打包配置，避免重新发明版本；当前 B 未提交文件不会被覆盖。B/C 后续阶段完成后继续由集成负责人审查并合入。

由集成负责人维护，供 A/B/C 查阅。各流自己的交付记录继续留在对应文档；本文件记录合并后的验证与协调事项。用户要求最终仅编译 Windows 版本并启动验证，其他平台不纳入本次交付。

## 已合入主分支

- B：完整原型基线、公共契约/构建 M0（`34157d2`），设置与凭据 B1（`abccee0`）。
- C：字体/许可证及 Fluid 来源审查（`295f650`、`b95a207`）。
- A：领域算法、版本 SQL 与迁移运行器（`1f400c1`、`7923e15`、M0 合并 `cb8f529`）。
- 集成负责人：版本化备份模块（`b5c9da8`）、Markdown 导出模块（`97f2f12`），共 36 项行为测试通过；当前是纯格式模块。

原工作区的 33 个未提交源文件已逐一与 B 的原型保存提交 `be3eb5f` 比较，内容一致后保留 Git stash 快照 `89cb4b632f703ab44170fb747097675d8f08cec7`，再合入正式基线。快照仍保留，不覆盖或丢弃用户原有文件。

## 已执行的集成验证

Node 22.22.0 / npm 10.9.2；在独立工作区 `.cache/root-portability` 顺序执行 check、test、build，通过 29 项默认业务/契约/平台测试。迁移运行器与随机 schema 清理的 8 项替身测试单独运行通过；这些用例尚未搬入默认 unit 组。备份的 24 项行为测试单独运行通过。以上结果对应 A 的 M0 合并阶段，不代表后续 IPC/UI/服务工厂已集成。

2026-10-16：另行准备隔离的真实 PostgreSQL 17.6 / pgvector 0.8.6 / pg_trgm 1.6，`tests/acceptance/postgres.sql` 已实际通过。覆盖两份正式迁移、分类种子、标题/标签/正文数据库约束、revision 竞争、旧 chunk/软删除过滤、中文 FTS/单字匹配及 3072/1536 维 HNSW 的真实最近邻与执行计划。小样本中显式关闭 sequential scan，仅证明索引表达式可执行与可被使用，不声称大规模召回率或性能达标。脚本每次生成随机 schema，整个事务最终 ROLLBACK；失败时 psql 退出同样回滚。

运行方式：先在专用测试库的 public 安装 vector >=0.8 与 pg_trgm，再用该库的显式连接运行：

```powershell
psql --dbname $env:TEST_DATABASE_URL -X --file tests/acceptance/postgres.sql
```

应用服务、任务恢复、跨 generation 切换、网络 provider 和 UI 链路仍需后续阶段验证。没有 OpenRouter/Cohere 凭据，当前没有真实付费 eval 结果。

## 本机隔离数据库入口

运行时在主工作区 `.cache/test-postgres-runtime/pgsql/`，数据目录 `.cache/test-postgres-data/`；监听 `127.0.0.1:55437`，测试数据库/角色均为 `zhiyu_test`。测试密码文件在忽略的 `.cache/test-postgres-password.txt`，只用于此隔离测试实例；不要将它写入提交或产品默认设置。A/B 后续可以显式构造 TEST_DATABASE_URL 复用该测试库，并继续使用各测试自己创建的随机 schema。

运行时来自 EDB PostgreSQL 17.6-2 Windows x64 binary zip，SHA-256 `46128e93245cab5fd18beb13e10a43ad8b31acf9bef1790a811bd59f1b721a58`。测试用 pgvector Windows 二进制来自 `andreiramani/pgvector_pgsql_windows` 的 `0.8.6_17` release，按 GitHub asset digest 核对 SHA-256 `420388e9e9f05d92f06d6967ce8772483629b27a66ca9255925fa0fdd445438e`。这些运行时仅位于忽略缓存，不属于应用源码或分发包。

## 给平台流的接入请求

- 默认 unit 发现需加入 `tests/portability/`；备份和 Markdown 导出复用公共 DTO，不新增 IPC。目前先用 `node --test .cache/test-dist/tests/portability/backup.test.js .cache/test-dist/tests/portability/markdown.test.js` 显式运行。
- A/C 的依赖请求分别在 `docs/data-retrieval.md`、`docs/ui-components.md`。尚需公共锁定 `pg`/类型、LangChain/tokenizer 及 UI 所需库；由 B 统一发布依赖提交，其他流更新到该提交后消费。
- B2 的 `fd606c8` 已合入独立集成分支，check → 42 项默认测试 → build → 4 项真实 Electron 检查通过；这些 Electron 用例覆盖沙盒、固定 IPC、攻击参数、safeStorage 跨重启和未注册窗口。待 A 导出 `createKnowledgeService` 后注入组合根。使用未注入服务的 CONFIG_REQUIRED 不能作为真实知识库完成结论。
- B2 审查发现：`OperationRegistry` 永久保留已结束的 search/assistant/reindex 记录，单窗口累计 4096 次后所有新操作会返回 CONFLICT。已先用两个 4100 次连续操作测试复现，再保留有上限的最近完成 UUID 历史，保留重复检测、owner 隔离和 32 个活动调用限额；3 项新增回归测试通过。合并提交 `3c7eb61` 同时包含 B2 与格式模块文档，保留现有历史，以后续修复提交完成此集成阶段验证。
- 最后在同一集成状态执行 check → test → build，再运行数据库、browser、desktop 和 Windows 包检查；启动打包后的应用，验证原生标题栏拖动和主要交互。具体结果届时追加。
