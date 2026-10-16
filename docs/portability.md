# 数据可迁移模块

模块由集成负责人独立实现于 `src/lib/portability/`，行为测试在 `tests/portability/`。复用 M0 的公共 `Collection` / `Document` 及运行时 schema，不新增 IPC、数据库连接或第二套存储。当前为可调用的格式模块，尚未增加界面入口或数据库恢复事务。

## 版本化 JSON 备份

`createBackup(snapshot, { appVersion, exportedAt? })` 返回 UTF-8 JSON 文本；`readBackup(text)` 在校验成功后返回 `BackupEnvelope`。调用方必须从同一数据库快照获取全部分类和文档（含回收站），避免导出期间的并发修改导致关联不一致；数据库写入与原生文件选择器由各自 adapter 负责。

磁盘格式固定为 `format: "zhiyu-knowledge-backup"`、`version: 1`。payload 只含分类与文档；保留 UUID、Markdown、标签、收藏、revision、创建/更新时间及软删除状态。凭据、设置、对话、向量和派生索引不进入备份，未来恢复后重建索引。旧原型先通过正式迁移接口转为 UUID 文档，再使用此格式。

导出先投影白名单字段，防止调用方对象附带的 API key 或 embedding 被序列化。读取严格拒绝未知或缺失字段、未知版本、重复 UUID、无效分类引用及违反公共契约的数据。标题和标签必须已经规范化；备份不静默 trim、去重或截断内容。不会修改传入数组或对象。

每篇正文最多 2 MiB UTF-8；最多 10,000 篇文档、1,000 个分类；整个 JSON 文件最多 32 MiB，计入 JSON 转义及摘要字段的开销，创建和读取两端都执行上限。超限返回 `LIMIT_EXCEEDED`，由调用方说明原因，不能悄悄丢弃条目。

完整性字段是 `integrity: { algorithm: "SHA-256", digest }`。摘要覆盖固定顺序序列化的 format、version、appVersion、exportedAt 和 payload；分类与文档按 UUID 的代码单元顺序排序，字段顺序固定。JSON 缩进和对象键顺序不影响读取；合法数组重排在校验前规范化。摘要用于检测意外损坏，不提供加密或身份认证；重新计算摘要的人能够改写内容。

错误通过 `BackupError.code` 区分 `INVALID_JSON`、`INVALID_FORMAT`、`UNSUPPORTED_VERSION`、`LIMIT_EXCEEDED`、`DUPLICATE_ID`、`INVALID_REFERENCE` 和 `INTEGRITY_MISMATCH`；中文错误不回显原始文件、SQL 或凭据。公共 IPC 若接入此能力，应由平台映射到现有错误信封，不直接传送 Error 对象。

## 接入与验证

运行时需要 Node 22 或带 Web Crypto 的安全浏览器上下文。模块不访问 `window`、Electron、文件系统或网络，不添加依赖；SHA-256 使用 Web Crypto。

M0 的测试编译包含全部 `.test.ts`，其默认 unit 发现目前只扫描 domain/search/contracts/platform。集成时应将 `portability` 加入默认发现；此前显式运行：

```powershell
. 'D:\Warp\demo\scripts\Use-LocalRuntime.ps1'
npx tsc --project tsconfig.tests.json
node --test .cache/test-dist/tests/portability/backup.test.js
```

行为测试覆盖中文与 emoji、Markdown 原文、空库/空正文/回收站、稳定序列化与输入不变、敏感字段排除、损坏与嵌套字段、UUID/引用/版本、UTF-8 和条目/文件上限。真实数据库的一致性快照和恢复事务须在 adapter 接入阶段验证。
