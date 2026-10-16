# 三个 agent 的并行交付入口

本目录是给三位实现 agent 的任务书。当前仅交付设计；用户会分别分发下列三份文档。不要在本轮自动启动实现 agent。

| Agent         | 直接交接文档                                           | 负责结果                                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| A：数据与检索 | [01-data-retrieval.md](01-data-retrieval.md)           | PostgreSQL、分块/向量、混合检索、Cohere、LangChain、领域/数据库/eval 测试 |
| B：桌面与集成 | [02-desktop-integration.md](02-desktop-integration.md) | 公共契约、主进程/preload、凭据/设置、安全、构建、Windows、最终集成        |
| C：界面与体验 | [03-ui-experience.md](03-ui-experience.md)             | Fluid UI、中文字体/logo、检索/助手/设置交互、浏览器测试                   |

每位都先阅读根目录 `AGENTS.md`、`Designlang.md`、[架构](../architecture-v1.md)、[契约](../contracts-v1.md) 与 [开发原则](../development-principles.md)。三份任务书包含独立的范围、阶段、验收和交付要求，可直接作为开工指令。

## 公共起点与并行方式

仓库存在尚未提交的原型文件，旧 HEAD 不包含完整应用。B 先审查现有工作区并按原有阶段完成可归属的原型提交，再建立 M0：公共 contracts/schema、测试发现、Electron 编译与依赖基线。不要直接从旧 HEAD 建 worktree 后重写缺失项目。

三位可以同时读取文档与准备任务；A 可写领域算法/SQL 方案，C 可整理 Fluid 组件与纯展示稿。M0 由 B 提交后，三条实现分支从同一完整 baseline 开始，或在各自尚未提交修改前更新到该 baseline。推荐工作区：

```text
<project-parent>/zhiyu-a-data       branch feat/data-retrieval
<project-parent>/zhiyu-b-platform   branch feat/desktop-platform
<project-parent>/zhiyu-c-ui         branch feat/fluid-workspace
```

各自有独立依赖安装、`.next`、输出、userData 和数据库测试 schema；node_modules、运行数据与生成文件不进入提交。不要在同一目录共用 Git index，也不要并行读写同一 `.next/types/`。

## 文件所有权

| 路径                                                                                                               | 唯一修改负责人      |
| ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `src/lib/domain/**`、`electron/services/knowledge/**`、`db/**`                                                     | A                   |
| `tests/domain/**`、`tests/search/**`、`tests/integration/**`、`tests/evals/**`                                     | A                   |
| `src/lib/contracts/**`、`src/lib/desktop.ts`、`electron/main.ts`、`electron/preload.ts`、`electron/composition.ts` | B                   |
| `electron/platform/**`、`electron/ipc/**`、`tests/contracts/**`、`tests/platform/**`、`tests/desktop/**`           | B                   |
| `package.json`、`package-lock.json`、根配置、`scripts/**`、`.env.example`、`.gitignore`、CI                        | B                   |
| `src/app/**`、`src/components/**`、`src/features/**`、`src/lib/client/**`、`public/**`、`Designlang.md`            | C                   |
| `tests/browser/**`                                                                                                 | C                   |
| `docs/data-retrieval.md`                                                                                           | A                   |
| `docs/ui-components.md`                                                                                            | C                   |
| `README.md`、`AGENTS.md`、顶层设计/契约文档、`docs/validation.md`                                                  | B（跨流变更先协调） |

只读访问其他路径不受限。新增跨边界文件必须先确定负责人；不能三人各改一版 package/lockfile 或公共 DTO 再让集成人猜测哪版正确。需要调整别人代码时提供具体字段、调用和验收用例，由对应负责人修改；最终 cherry-pick 冲突由 B 串行处理并验证。

## 共享依赖和接口协调

A/C 向 B 提供依赖名称、用途、兼容要求和新增脚本入口，不在各自分支运行会改 lockfile 的安装。B 统一审查、安装、锁定并发布共享依赖提交；消费者按提交更新。

契约在 M0 由 B 从设计落实。A 提供 `createKnowledgeService`，B 注入设置/秘密/事件与 cancellation context，C 使用 `KnowledgeClient` 或显式 demo adapter。开发时允许 mock，交付时主链路必须真实连通。

接口提案格式：`现状 → 新字段/行为 → 原因 → 受影响消费者 → 兼容方式 → 验收`。B 同步公共 schema 后通知 A/C；不能让一个消费者静默依赖文档里不存在的返回值。

## 集成顺序与门禁

1. B 提交完整 baseline / M0，公布 commit 和依赖。
2. A/C 同时推进各自可审查阶段，并在每阶段检查后本地 commit。B 并行做 IPC、秘密、窗口与打包。
3. B 先集成 A 的服务工厂和连接/设置实现，再集成 C 的真实 client 接线；保留 demo 只用于浏览器测试。
4. 三人根据集成失败各自修复所属文件。B 不为消除失败而关闭安全参数、放宽 schema 或删掉测试。
5. B 在干净集成 worktree 顺序执行 check/test/build，接着数据库、browser、desktop、Windows 目录包与配置允许时的 live eval。
6. 输出验证报告、提交清单和外部阻塞。未具备运行环境的检查标为未验证，完整功能不能被这些缺项冒充。

交付报告统一说明：完成行为、修改路径、测试命令/结果、依赖的其他提交、必要配置、迁移/回滚、已知限制。不得推送远程、改历史、清理未知用户数据或删除 Prime Agent 工具。
