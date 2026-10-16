# 项目协作约定

## 目标与技术栈

构建本地优先的桌面知识库系统。使用 Electron、Next.js App Router、TypeScript、Tailwind CSS 和 shadcn/ui。界面与用户文档优先使用中文。

## 必读设计与开发依据

- [Designlang.md](Designlang.md)：所有 UI 工作前必读，规定 Fluid Functionalism/shadcn、Geist/霞鹜文楷、字号、Lucide、毛笔标志、动效与窗口交互。
- [docs/architecture-v1.md](docs/architecture-v1.md)：混合检索知识库的当前架构；PostgreSQL + pgvector 是 v1 事实存储，替代初始化文档中的 SQLite 后续计划。
- [docs/contracts-v1.md](docs/contracts-v1.md)：公共 DTO、IPC、服务边界、设置默认值和错误语义；跨 agent 接口以此为准。
- [docs/development-principles.md](docs/development-principles.md)：结合 KISS、DIY 与 obra/superpowers 的开发方法，强调行为测试、系统排错、验证和阶段提交。
- [docs/agents/README.md](docs/agents/README.md)：三个 agent 的目录所有权、公共基线和集成顺序；并行工作前阅读对应任务书。

首版检索链为中文关键词 + OpenRouter `openai/text-embedding-3-large` 向量召回 → 加权 RRF → Cohere `rerank-v3.5`；底层使用 LangChain TypeScript。AI 与数据库凭据只由 Electron 主进程管理。实验阶段只验证 Windows x64；保留原生标题栏并测试实际拖动。共享配置、契约、依赖与锁文件由平台集成负责人统一修改。

## 目录边界

- `src/app/`：Next.js 页面、布局和全局样式。
- `src/components/ui/`：shadcn/ui 基础组件；业务组件放在上层目录。
- `src/features/`：按业务域组织知识库功能。
- `src/lib/`：公共工具与共享类型。
- `electron/`：主进程、preload 和桌面平台逻辑。
- `scripts/`：开发、构建、校验脚本。
- `tests/`：业务行为和集成测试。
- `docs/`：架构、阶段记录与后续计划。

## 实现原则

- 页面默认使用 Server Components；交互边界才声明 `use client`。
- 桌面生产版本使用 Next.js 静态导出；需要 Node 或文件系统的功能放在 Electron 主进程，通过明确且最小化的 preload API 访问。
- 保持 `contextIsolation: true`、`nodeIntegration: false` 和渲染进程沙盒；验证 IPC 调用来源与参数。
- 业务模型和存储接口独立于 UI，便于后续添加 SQLite、全文检索和同步。
- 不删除或改写目录里原有的 Prime Agent 工具。
- 不提交依赖、生成文件、凭据、本地数据或打包产物。

## 持续 Git

用户明确要求每个步骤持续 Git：每完成一个独立、可审查、可回滚的阶段，先执行相应检查，再创建本地 Git 提交。不要等所有工作结束才一次性提交。

- 使用 Conventional Commits，例如 `chore: initialize project conventions`、`feat: add knowledge workspace`。
- 提交前检查 `git diff --check` 和 `git status`；只暂存当前阶段相关的文件。
- 不覆盖用户未提交的修改，不改写已有提交历史，不自动推送远程。
- 校验因环境限制无法运行时，如实记录限制，不能宣称检查通过。

## 交付校验

项目脚本建立后，执行 `npm run check` 和 `npm run build`。影响桌面集成的改动应执行桌面冒烟检查，影响业务行为的改动应执行相应测试。检查通过后无需重复无关校验。
