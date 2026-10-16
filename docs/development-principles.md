# 开发原则 · KISS、DIY 与 Superpowers

版本 1.0，2026-10-16。本文是对用户指定开发方向的仓库内约定；与用户当前明确指令冲突时，优先遵守用户指令。

## 1. 参考项目与采用范围

选择 [obra/superpowers](https://github.com/obra/superpowers)，名称与用户描述一致，是开源 agent 开发方法和技能集合。2026-10-16 读取的 GitHub API 返回 300,204 stars，仅作检索时热度记录；可复核的参考 revision 为 [`bb92a77741419a4ab5f06e711a283343f1ada0c3`](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3)，项目采用 MIT 许可。

本项目提炼其 README 中的设计先行、明确计划、测试驱动、系统排错、完成前验证和代码审查方法。原始技能入口包括 [test-driven-development](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/test-driven-development/SKILL.md)、[systematic-debugging](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/systematic-debugging/SKILL.md) 和 [verification-before-completion](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/verification-before-completion/SKILL.md)。

本次按“找到开发方法文档”的需求引用并写入本地原则，未安装全局 skill/plugin，也未改写原有 Prime Agent。将来若用户要求安装，由对应 agent 检查当前环境和最新官方安装说明。外部文档中要求删除未先测试的代码、自动派出子 agent 或重复征求批准的流程，不自动成为本仓库的新权限规则。

## 2. 简单实现与可控复用

- **KISS**：单主进程应用服务、PostgreSQL 单一事实存储、固定两步 RAG；没有证据不要增加微服务、Redis、消息总线、全局状态框架或多代理运行时。
- **DIY**：领域流程、混合融合、错误语义和 adapter 边界自己掌握；成熟基础能力使用 Electron、PostgreSQL、LangChain、shadcn/Radix 等库。不要重写数据库、密码学或组件可访问性基础设施。
- **DRY**：输入范围、默认设置和 DTO 只在共享契约定义一次；不因两处相似 JSX 就提前建立通用渲染引擎。
- **YAGNI**：先完成本次验收路径；同步、公共 Web 后端、PDF/OCR、Agent 工具执行按后续需求再做。
- **可回滚**：代码、迁移、设置版本和索引 generation 都有明确边界；不得靠清空用户数据解决版本或索引问题。

## 3. 每个独立阶段的工作闭环

1. 阅读 `AGENTS.md`、`Designlang.md`、架构、契约和自己的分工任务书，检查 Git 状态与已有源码。
2. 先写具体结果与边界，确认该阶段拥有的文件、依赖、失败状态和验收命令。已有明确授权的工作直接推进，常规选择由 agent 判断。
3. 为新业务行为或 bug 编写有意义的失败测试；确认其因目标行为缺失而失败，再写最小实现。
4. 运行相关测试、类型/lint 和必要的交互/桌面检查；重构后重跑受影响测试。不要把 UI 渲染快照当作业务行为测试。
5. 做差异审查：安全边界、资源清理、数据兼容、错误与降级、测试是否真的执行，以及是否超出范围。
6. 执行 `git diff --check` 与 `git status`，仅暂存阶段所属文件，创建 Conventional Commit 本地提交；不改写已有历史、不自动推送。
7. 记录交付、证据、环境阻塞和下一阶段入口。执行失败必须保留真实结果，禁止把未执行、跳过或旧结果写作通过。

纯文档、许可记录和静态品牌源文件不需要为文件存在编写镜像实现的测试；用格式、链接、SVG 结构和人工审查验证。本次用户要求严格测试，所有实现阶段的业务/集成/交互检查都必须落实。

## 4. 系统排错

先复现并保留最小输入、错误码和运行环境，再区分 Renderer、IPC、服务、数据库与外部 provider。提出一个可验证的原因，做最小修复，并以能失败的回归测试证明。不要同时改多个未知点、关闭安全参数、吞掉异常或放宽断言来让测试变绿。

网络失败区分配置、认证、额度、超时和服务故障。数据库错误区分连接、schema、并发冲突与查询。先用合成文本和 mock 定位，不为了调试上传整个私人知识库。

## 5. 并行开发约定

使用三份 [agent 任务书](agents/README.md) 的文件所有权。每个 agent 独立分支/worktree；未经协调不改其他流的实现。公共 contracts、package/lockfile、构建配置与根脚本由 B 维护。

接口变化通过明确的字段/行为提案协调，在所有消费者同步前不能单方改变。A/C 可先基于冻结的文档契约开发领域函数与 demo，B 完成 M0 后统一共享类型。

agent 交付时先验证需求符合度，再审查实现质量；本轮不要求为了审查额外创建 agent。用户将三份文档分发后，再按对应执行环境进行协作。不要在同一工作区并行运行会改写 `.next` 或共享 Git index 的操作。

## 6. 测试与完成标准

离线单元、数据库集成、provider mock、浏览器和 Electron 各有独立证据。真实 eval 使用合成数据，显式环境开关和预算，保持脱敏；付费调用不嵌入日常 `npm test`。

实现交付按照 `npm run check` → `npm test` → `npm run build` 顺序，之后按改动运行 browser/desktop 与数据库检查；最终由 B 验证 Windows 目录包。只有相应命令实际通过才可声明完成。受环境限制时，报告命令、错误、影响和补验步骤，不能通过跳过检查获得“全绿”结论。

## 7. 文档与权限

用户已经要求的架构、分工、测试与本地阶段提交不重复请求许可。文档不自动授权发消息、发布网站、推送分支、合并远程或使用未提供的凭据。必需的信息缺失时先做独立可推进的工作，交付时明确缺项；不要把常规实施选择变成用户的审批负担。
