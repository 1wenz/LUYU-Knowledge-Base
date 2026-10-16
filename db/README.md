# PostgreSQL 数据层准备

当前提供版本 SQL、迁移运行器、pg 连接池、事务 CRUD、revision 分块/FTS/job 写入、可恢复 worker、generation 重建和两路 SQL 召回；公共契约已接入 M0，共享依赖采用 CTO 的 `b7a9b77`。完整服务工厂见 `electron/services/knowledge/index.ts`。

## 初始化与迁移

要求 PostgreSQL >=17、安装在 `public` 的 pgvector >=0.8 和 pg_trgm。由数据库管理员在明确选择的应用/测试数据库执行 `setup-extensions.sql`；应用不自动创建角色、数据库、密码，不升级扩展。已有旧版扩展时，先备份再按服务器提供的升级路径执行 `ALTER EXTENSION vector UPDATE`。

```powershell
psql --host 127.0.0.1 --dbname zhiyu --username postgres --file db/setup-extensions.sql
```

应用角色需要目标 schema 的建表、函数、索引和数据读写权限。`applyMigrations(pool, [{version, sql}, ...], {schema, signal})` 接收可信 SQL 资源，按版本在事务中执行；默认 schema 为 `public`。自定义 schema 必须已存在且可访问，不能退回其他命名空间。

迁移记录由运行器创建，采用 LF 规范化后的 SHA-256。版本须从 1 连续递增，已应用文件不得原地修改。未知/缺失版本、checksum 变化、扩展缺失或版本过低返回 `SCHEMA_MISMATCH`。迁移有事务级 advisory lock、5 秒语句/锁等待上限、参数化账本写入和连接释放；网络与数据库异常不会原样返回给 UI。

SQL 必须作为受信任的应用资源加载。B 的打包管线需要复制全部三份迁移到 `dist-electron/db/migrations/`（工厂默认 bundle 旁目录），或注入可信 `Migration[]`。工厂明确按 UTF-8 读取 SQL，不接受 Renderer 传入 SQL 或资源目录。

worker 阶段新增 `003_embedding_cache.sql`；打包必须按版本包含全部三份 SQL。既有迁移 checksum 不变。

## 表与索引

`001_knowledge.sql` 建立分类、文档、generation、带 revision 的 chunks、原精度 embeddings、带租约的恢复任务与导入幂等账本。导入条目映射单独成表，避免把任意 JSON 或回调作为持久化模型。仅插入三条原型分类，不插入笔记。

| 原型 id     | 新 UUID                              | 名称/顺序    |
| ----------- | ------------------------------------ | ------------ |
| product     | 00000000-0000-4000-8000-000000000001 | 产品设计 / 0 |
| engineering | 00000000-0000-4000-8000-000000000002 | 技术笔记 / 1 |
| ideas       | 00000000-0000-4000-8000-000000000003 | 灵感碎片 / 2 |

此映射供 CTO/B/C 协调旧数据导入；若 M0 已冻结不同 UUID，需在迁移首次发布前同步，不得在已有用户数据库中改写迁移。

`002_search_indexes.sql` 建立中文 FTS/字面 trigram 索引，以及 `embedding::halfvec(3072)` HNSW 和 `embedding::vector(1536)` partial HNSW 索引。存储始终保留原始 float32。生产 SQL 的 3072 halfvec ANN → float32 重排已经在真实 PostgreSQL 执行并验证可使用 HNSW。1536 provider 路由能力未验证，不宣称可用。

## 测试隔离与待补验

`tests/integration/test-schema.ts:withOwnedTestSchema` 每次生成 `zhiyu_test_<32位随机十六进制>`，只清理自己成功创建的 schema，创建失败时不执行 DROP；不接受调用方指定已有 schema。数据库扩展应由管理员预装，测试不能删除或重装数据库级扩展。

离线迁移测试使用 SQL 端口替身，只验证控制流。新增 `tests/integration/persistence-search.test.ts` 在 CTO 明确提供的隔离 PostgreSQL 17.6 / pgvector 0.8.6 实例中创建随机 schema，实际执行正式迁移、CRUD/回滚/revision/导入幂等、中文 FTS/单字/字面通配符、过滤/软删除/旧 revision，以及 3072 维召回和 `EXPLAIN (ANALYZE, BUFFERS)`。小样本 plan 验证显式关闭顺序扫描与排序，只证明生产查询可利用对应索引，不代表真实规模性能或召回率。

使用 `npm run test:db` 和专用 `TEST_DATABASE_URL` 运行集成测试；缺配置时非零退出，不计为通过。连接变量只由测试入口读取，业务服务不读环境变量。当前 12 项真实数据库测试包含任务恢复、generation 切换和服务全链路；provider HTTP 为合成替身，IPC/UI 和真实 provider 仍需平台集成验收。

## 备份与回滚

升级前在仓库外保留 PostgreSQL 自定义格式备份，例如 `pg_dump --host 127.0.0.1 --dbname zhiyu --username zhiyu --format custom --file D:\Backups\zhiyu-before-upgrade.dump`。只在管理员明确选择的恢复目标库中使用 `pg_restore`，不自动覆盖现有库。

当前没有破坏性 down migration。部署回退前核对 schema 兼容性；旧程序遇到未知迁移应停止，而不能删表、清空用户数据或改 checksum 绕过检查。索引重建在新 generation 核对全部当前 revision 后切换；失败/取消保留旧 active，成功后旧代标为 retired，当前不自动删除旧向量。
