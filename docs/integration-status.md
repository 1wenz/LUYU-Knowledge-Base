# 集成负责人工作记录

## 最新协调（2026-10-16）

A 的 `5cb6ce1`、`8e21ab7`、`98e623c`（分支整合点 `c42d49b`）已接入主进程组合根，显式传入 bundle 内的 `knowledgeMigrations`。main 顺序 check、133 项离线测试、build、17 项真实 PostgreSQL 测试、6 项真实桌面测试全部通过。桌面新用例在自己创建的数据库中验证保存/收藏/中文关键词/来源行/删除恢复及真实重启持久化，密文文件不含测试密码，结束后仅清理自己拥有的数据库；未配置 provider key 仍可完成该链路。

数据库桌面用例先在未注入工厂的 bundle 上因保存无法成功而失败，接线后通过。夹具先等待首个页面 load，失败清理时仅销毁自己持有的测试窗口，避免合成未保存草稿阻塞 teardown；普通负例使用随机不存在库名/角色和本机端口 1，避免触及机器上的默认数据库。C 的最后布局/焦点修正及 A 的 eval runner 仍待后续合并，Windows 最终包尚未生成。

Fluid 桌面用例已与 main 同步，E2E 类型检查、5 项真实桌面组和 3 次独立拖动重复通过；渲染缩放 1.25，原生 DPI=192。复验发现辅助脚本原先混用坐标尺度及窗口被其他活动遮挡，现统一物理坐标、验证真实标题栏命中与点下窗口，并仅置顶自己拥有的被测窗口。真实数据库用例仍等待生产工厂。

C4 `3a27137` 已在 main 完成整合验证：check、121 项离线测试、build、31 项 Edge 生产浏览器测试全部通过。设置覆盖数据库/凭据、聊天模型、embedding 维度、分块、候选/重排/片段数、温度与预算、外观、显式重建和关于信息；冲突和秘密清除已有行为测试。真实 safeStorage/数据库/重建联调将随服务工厂注入后验收。

迁移资源阶段 `92851c5` 已在集成 worktree 验证：主进程 `.sql` text loader 和 `electron/platform/migration-resources.ts` 的 `knowledgeMigrations`，通过实际 CJS bundle 在临时目录逐项核对版本/checksum。A 的工厂请接收显式迁移参数（例如 `createKnowledgeService(deps, { migrations })`），组合根负责传入这些可信资源；无需 A 从文件系统或 renderer 加载 SQL。

该资源阶段与 C4 合并后，main 再次顺序 check、121 项离线测试、build 通过；未放宽外部依赖门禁。正式主进程入口将在 A 工厂完成时显式引用资源。

A 的 `c8b852c` 已完成整合验证：check、121 项离线测试、build、12 项真实数据库测试通过。新增 LangChain embedding adapter 和持久化索引 worker，真实数据库覆盖缓存复用、旧 revision/删除保护、部分成功后恢复、过期租约与取消释放。provider HTTP 使用合成 mock；完整服务工厂、generation 切换和聊天生成仍在 A 分支推进。

C3 `df86893` 已在 main 完成整合验证：check、117 项离线测试、build、27 项 Edge 生产浏览器测试全部通过。助手复用 Border Beam，先订阅事件再发送请求，校验 operationId/seq/唯一终态与来源白名单，支持停止、重试和视图切换清理。浏览器使用契约 fixture；真实生成仍等待 A 的服务工厂和聊天 provider，当前不作为付费 API 或桌面 RAG 已接通的证据。

C2 `e3fc75c` 已合入 `8e574bb`：main check、114 项离线测试、build、23 项 Edge 浏览器测试通过。正式工作区使用契约 client，覆盖文档操作、导入去重、冲突保留草稿、来源定位和查询竞态；助手/设置等待 C3/C4。

A 的 `a00270d` 已完成整合验证：check、117 项离线测试、8 项真实数据库测试、build 通过。真实测试覆盖生产 pg adapter、立即可搜索的中文分块、3072 halfvec ANN/float32 重排、过滤/删除和生产 SQL 的 HNSW 执行计划。小样本强制关闭顺序扫描仅证明索引可用，不作为性能/召回率结论。embedding worker、重建和 service factory 等待 A 后续阶段。

集成负责人在独立 worktree 准备真实桌面到 PostgreSQL 的端到端验收：创建自己拥有的新测试数据库和隔离 userData，使用真实 preload/IPC/UI 保存、检索、来源、恢复及重启。该用例将等待生产 service factory 注入后运行，并复用于最终 Windows 目录包；当前不计为通过。

A 的 `f5b50af`、`d41baec` 已审查并集成：事务仓储、公共 schema 复用和 provider 原始 JSON 校验。主工作区顺序执行 check、57 项默认测试、build 均通过。后续 `6219623` 的混合检索/Cohere 编排合入 `10ce335`，当前离线测试 109 项通过，专项 Electron 类型和 ESLint 检查通过。

真实仓储验收 `tests/acceptance/persistence-db.test.ts` 已在隔离 PostgreSQL 上通过 5 项（含父测试），覆盖迁移幂等、并发 revision、正文参数化、收藏/软删除/恢复、分类关联、并发重复导入、派生写入失败全事务回滚和新连接持久化。已加入 `npm run test:db` 的发现目录；仅使用显式专用连接和随机 schema。SQL 级索引计划与仓储证据互补，worker/generation/provider 主链路仍待 A 后续提交。

C 的 `91eb6d7` 已审查并集成：本地字体、Fluid 基础组件、毛笔品牌、Border Beam、设计预览与私人页面 noindex。主工作区 check、57 项默认测试、build、12 项 Edge 浏览器测试通过。此阶段验证设计基线和原型兼容性；正式 KnowledgeClient、搜索、助手和设置仍待 C 后续提交。

共享依赖已由 `b7a9b77` 锁定并合入 main（清单见 `docs/dependency-baseline.md`），portability 和离线生命周期回归已纳入默认测试。A 已合入该依赖基线；C 可更新后使用 Markdown 等库。B 的 `85c21b4` Windows 平台交付已合入 `eacb021`，正在验证整合后的 check/test/build/desktop；新增 E2E 类型配置需要 `DOM.Iterable` 来覆盖 C 的 FontFaceSet 测试。各 agent 的活动 worktree 保持独立，后续完成阶段继续审查合并。

B4 `8467d64` 和 E2E 的 DOM.Iterable 修复整合后，main 顺序 check、113 项离线测试、build、5 项真实 Electron 检查全部通过。Windows 用例使用 SendInput 实际拖动标题栏，并验证最大化后的按钮/输入与退出进程清理。最终 Windows 目录包将等待 A/C 主链路合并后重建并实际打开。

额外的离线依赖 bundle 探测已复现 `pg-native` 可选外部引用：纯 JS pg、LangChain embedding/chat、cl100k_base 均能在 CJS bundle 运行，但打包器的外部引用门禁会正确拒绝 pg-native。集成负责人随后补纯 JS 驱动约束与回归，不放宽外部依赖白名单；A 无需在服务层安装原生驱动。

该问题已修复：构建将可选 pg-native 入口映射为遵循 pg 的 MODULE_NOT_FOUND 回退的本地模块，打包依赖仍严格限制为 Electron/Node 内建。新增回归先复现门禁拒绝，再验证实际 CJS bundle 的 pg JavaScript driver、LangChain embedding/chat 和中文 tokenizer 离线运行；main 顺序 check、114 项默认测试、build 均通过。fixture 只构造合成配置，未打开数据库连接或调用模型。

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
