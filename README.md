# 知屿 · Knowledge Base

使用 **Electron + Next.js App Router + shadcn/ui** 构建的本地优先知识库桌面工程，使用 TypeScript 和 Tailwind CSS。

设计交付入口：[架构](docs/architecture-v1.md)、[设计规范](Designlang.md)、[公共契约](docs/contracts-v1.md)、[开发原则](docs/development-principles.md)、[三位 Agent 的分工](docs/agents/README.md)。

当前 main 已接通 Fluid 工作区、来源检索、助手/设置界面、桌面平台及 PostgreSQL 服务。Windows x64 实验目录包及 NSIS 安装包已生成，目录包已通过真实数据库、重启、加密、窗口拖动等 6 项桌面测试，并已打开供查看。安装包路径、校验值和配置方式见 [Windows 交付说明](docs/windows-delivery.md)，最新集成证据见 [集成记录](docs/integration-status.md)。真实云端 eval、开发者公开资料和代码签名仍待补齐。

## 开始开发

需要 Node.js **>=22.12.0**、npm **>=10**。

```powershell
npm ci
npm run dev
```

`npm run dev` 编译 Electron、启动 Next.js、等待页面可访问，再启动桌面窗口。Next.js 支持热更新；主进程与 preload 的改动会自动编译，重新启动开发命令后生效。

本机另有一个项目内的 Node 22.22.0 / npm 10.9.2 运行时，放在忽略目录 `.runtime/`。可在 PowerShell 的当前会话启用：

```powershell
. .\scripts\Use-LocalRuntime.ps1
npm ci
npm run dev
```

该运行时不是仓库依赖；独立 worktree 会只读复用主 worktree 的 Node/npm 二进制，node_modules、构建、测试输出和 userData 各自独立。新克隆项目请安装符合版本要求的 Node。脚本不修改用户全局运行时或代理设置。

## 常用命令

| 命令                       | 用途                                                  |
| -------------------------- | ----------------------------------------------------- |
| `npm run dev`              | 同时启动 Next.js 和 Electron                          |
| `npm run dev:web`          | 浏览器开发，地址 `http://127.0.0.1:3000`              |
| `npm run check`            | Web、Electron、E2E 类型检查与 ESLint                  |
| `npm test`                 | 自动发现领域、检索、契约、平台、备份导出与回归测试    |
| `npm run test:db`          | 独立 TEST_DATABASE_URL 的数据库集成测试               |
| `npm run eval:live`        | 显式开关、两家 key、独立测试库与正整数预算的付费 eval |
| `npm run build`            | Next.js 静态导出 + Electron 编译                      |
| `npm run preview`          | 预览静态导出，地址 `http://127.0.0.1:3100`            |
| `npm start`                | 打开已构建的 Electron 应用                            |
| `npm run test:browser`     | Playwright 浏览器交互测试，需要先构建                 |
| `npm run test:desktop`     | Electron 静态页面与 preload 冒烟测试，需要先构建      |
| `npm run package:dir`      | 生成未安装的桌面打包目录                              |
| `npm run test:package:win` | 实际运行 Windows x64 目录包、验图标/沙盒/拖动         |
| `npm run package`          | 生成 Windows NSIS 安装包                              |
| `npm run release:check`    | 检查真实开发者资料，缺失时退出非零                    |
| `npm run format:check`     | Prettier 格式检查                                     |

浏览器测试首次运行需安装 Chromium：

```powershell
npx playwright install chromium
npm run build
npm run test:browser
npm run test:desktop
```

也可使用已安装的 Chrome：`$env:PLAYWRIGHT_CHANNEL = 'chrome'`。

并行浏览器验证可设置 `$env:ZHIYU_PREVIEW_PORT = '3122'`，避免占用另一位 agent 的 3100 端口。类型检查与 Next 构建按 check → test → build 顺序执行。数据库和 eval 缺配置、或 A 的测试尚未合并时会明确返回“未执行”和非零状态，不会把空测试组标为通过。live eval 还要求显式设置正整数 `EVAL_REQUEST_BUDGET`（初始使用 6）；具体 provider runner 必须将每次请求和重试计入同一预算。

## 桌面设置与构建资料

数据库由用户独立安装或连接已有实例，安装包不内嵌 PostgreSQL。需要 PostgreSQL >=17、public schema 中的 pgvector >=0.8 与 pg_trgm；角色、扩展、备份和迁移说明见 [db/README.md](db/README.md)。默认连接为本机 127.0.0.1:5432、数据库/角色 zhiyu，远程连接必须 verify-full。数据库密码及 OpenRouter/Cohere key 只经 settings/secrets IPC 由主进程保管。Windows safeStorage 不可用时可选择 session，不写明文；接口不能读回密钥。设置保存在现有 userData/settings.json，秘密密文在独立 credentials.json，不改变原 appId、productName 或正式 userData 路径。

聊天模型初始为空，须在“模型与 API”选择或填写实际可用的 OpenRouter ID。设置覆盖 embedding 维度、分块/重叠、两路候选与权重、重排、结果片段、温度和上下文预算。索引配置保存后需要明确开始重建，保留旧索引至新代次完成。字体、毛笔品牌、Border Beam 与交互规范见必读的 Designlang.md。

图标从 `public/brand/brush.svg` 同源生成到忽略目录 `.cache/branding/`，含 16/24/32/48/64/128/256 ICO；静态导出后复制 favicon、OG 与窗口图标到 out。主进程/preload 分别 bundle，构建检查 preload 仅依赖 Electron，主进程仅使用 Node 内建和 Electron。目录包不启动 Next 生产服务器。

公开开发者信息从构建进程环境的 ZHIYU_DEVELOPER_NAME、ZHIYU_HOMEPAGE、ZHIYU_REPOSITORY_URL、ZHIYU_SUPPORT、ZHIYU_COPYRIGHT 读取；变量清单见 [.env.example](.env.example)。未配置返回 null，UI 应显示“未配置”。这些变量需要在当前 shell 显式设置，不自动读取含凭据的本机环境文件。正式发布前填写真实资料并补齐完整产品验收、代码签名；实验目录包未签名，不代表具有 SmartScreen 信誉。

Windows 拖动测试使用限定进程/窗口的 SendInput，记录真实 bounds；会移动被测窗口和鼠标。测试使用 `.cache/desktop-tests/` 下的独立 userData，不读取正式凭据或笔记。

## CTO 集成与数据兼容

公共类型入口是 `src/lib/contracts/index.ts`，schema 与精确服务接口见 [contracts-v1.md](docs/contracts-v1.md)。工作区使用真实 KnowledgeClient 边界，浏览器 demo 必须明确选择。`electron/main.ts` 的组合根注入完整服务工厂与可信 SQL 迁移资源；服务延迟连接，数据库断联时设置仍可访问。服务服从 signal，数据库/密码变化关闭旧 pool 并重读秘密，dispose 释放连接和 worker；UI 已接入图标 metadata、noindex、本地 Geist/文楷与关于信息。

设置采用 schemaVersion 和 revision；损坏或未来版本保持原样，显式 v0 格式迁移先保存 `.v0.bak`。旧 localStorage 笔记由 C 的用户触发导入流程提交，不自动清理。回滚前备份原型 localStorage、userData 的设置/密文以及 PostgreSQL 数据和迁移版本。safeStorage 密文绑定原 Windows 安全上下文，不能视为可跨机器迁移的 API key 导出。

## 项目结构

```text
electron/                主进程、preload 和桌面资源协议
src/app/                 页面、布局与全局主题
src/components/ui/       从 shadcn/ui registry 引入的基础组件
src/features/workspace/  契约工作区、笔记编辑、来源检索、助手与设置
src/lib/contracts/       公共 DTO、schema 和服务/客户端接口
src/lib/domain/          领域校验、分块、融合和来源规则
src/lib/                 公共工具和桌面桥接类型
scripts/                 开发、预览与本地运行时脚本
tests/                   业务测试、浏览器测试、桌面冒烟测试
docs/                    架构、后续计划与初始化记录
```

## Git 工作流

每完成一个独立阶段，执行相关检查后创建本地提交，约定写在 [AGENTS.md](AGENTS.md)。

原型已分阶段保存，三个实现分支的已完成阶段由集成负责人依次审查、验证和合入 main；不推送远程、不改写历史。旧 `commit-initialization.mjs --apply` 的历史 fingerprint 已失效，不要再运行；平台证据见 [验证报告](docs/validation.md)，最新整合结果以 [集成记录](docs/integration-status.md) 为准。

原有 Prime Agent 工具继续保留，并从业务工程 Git 跟踪和格式检查中忽略。
