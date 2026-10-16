# 知屿 · Knowledge Base

使用 **Electron + Next.js App Router + shadcn/ui** 构建的本地优先知识库桌面工程，使用 TypeScript 和 Tailwind CSS。

当前 `feat/desktop-platform` 分支交付 Agent2 的公共契约、桌面安全 IPC、设置/加密凭据、窗口与 Windows 打包。PostgreSQL + pgvector 的 v1 架构以 [architecture-v1.md](docs/architecture-v1.md) 为准。

知识服务工厂需要 CTO 合并 Agent A 后注入，Fluid UI 和旧笔记导入需要合并 Agent C。未接入服务时知识 API 明确返回 CONFIG_REQUIRED；本分支保留的 localStorage 工作区是初始化原型，不能作为 v1 数据库、混合检索或助手已经联通的证明。验证范围与未完成项见 [validation.md](docs/validation.md)。

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

| 命令                       | 用途                                             |
| -------------------------- | ------------------------------------------------ |
| `npm run dev`              | 同时启动 Next.js 和 Electron                     |
| `npm run dev:web`          | 浏览器开发，地址 `http://127.0.0.1:3000`         |
| `npm run check`            | Web、Electron、E2E 类型检查与 ESLint             |
| `npm test`                 | 自动发现 domain/search/contracts/platform 测试   |
| `npm run test:db`          | 独立 TEST_DATABASE_URL 的数据库集成测试          |
| `npm run eval:live`        | 显式开关、两家 key 和独立测试库的付费 eval       |
| `npm run build`            | Next.js 静态导出 + Electron 编译                 |
| `npm run preview`          | 预览静态导出，地址 `http://127.0.0.1:3100`       |
| `npm start`                | 打开已构建的 Electron 应用                       |
| `npm run test:browser`     | Playwright 浏览器交互测试，需要先构建            |
| `npm run test:desktop`     | Electron 静态页面与 preload 冒烟测试，需要先构建 |
| `npm run package:dir`      | 生成未安装的桌面打包目录                         |
| `npm run test:package:win` | 实际运行 Windows x64 目录包、验图标/沙盒/拖动    |
| `npm run package`          | 生成 Windows NSIS 安装包                         |
| `npm run release:check`    | 检查真实开发者资料，缺失时退出非零               |
| `npm run format:check`     | Prettier 格式检查                                |

浏览器测试首次运行需安装 Chromium：

```powershell
npx playwright install chromium
npm run build
npm run test:browser
npm run test:desktop
```

也可使用已安装的 Chrome：`$env:PLAYWRIGHT_CHANNEL = 'chrome'`。

并行浏览器验证可设置 `$env:ZHIYU_PREVIEW_PORT = '3122'`，避免占用另一位 agent 的 3100 端口。类型检查与 Next 构建按 check → test → build 顺序执行。数据库和 eval 缺配置、或 A 的测试尚未合并时会明确返回“未执行”和非零状态，不会把空测试组标为通过。

## 桌面设置与构建资料

默认数据库为本机 127.0.0.1:5432、zhiyu/zhiyu；远程连接必须 verify-full。数据库密码及 OpenRouter/Cohere key 只经 settings/secrets IPC 由主进程保管。Windows safeStorage 不可用时可选择 session，不写明文；接口不能读回密钥。设置保存在现有 userData/settings.json，秘密密文在独立 credentials.json，不改变原 appId、productName 或正式 userData 路径。

图标从 `public/brand/brush.svg` 同源生成到忽略目录 `.cache/branding/`，含 16/24/32/48/64/128/256 ICO；静态导出后复制 favicon、OG 与窗口图标到 out。主进程/preload 分别 bundle，构建检查 preload 仅依赖 Electron，主进程仅使用 Node 内建和 Electron。目录包不启动 Next 生产服务器。

公开开发者信息从构建进程环境的 ZHIYU_DEVELOPER_NAME、ZHIYU_HOMEPAGE、ZHIYU_REPOSITORY_URL、ZHIYU_SUPPORT、ZHIYU_COPYRIGHT 读取；变量清单见 [.env.example](.env.example)。未配置返回 null，UI 应显示“未配置”。这些变量需要在当前 shell 显式设置，不自动读取含凭据的本机环境文件。正式发布前填写真实资料并补齐完整产品验收、代码签名；实验目录包未签名，不代表具有 SmartScreen 信誉。

Windows 拖动测试使用限定进程/窗口的 SendInput，记录真实 bounds；会移动被测窗口和鼠标。测试使用 `.cache/desktop-tests/` 下的独立 userData，不读取正式凭据或笔记。

## CTO 集成与数据兼容

公共类型入口是 `src/lib/contracts/index.ts`，schema 与精确服务接口见 [contracts-v1.md](docs/contracts-v1.md)。在 `electron/main.ts` 中给 `createPlatform` 注入 A 导出的 `createKnowledgeService`，再接入 C 的真实 KnowledgeClient。服务必须服从 signal，applySettings 关闭旧 pool 并重读秘密，dispose 释放连接和 worker。C 负责把图标 metadata、noindex、Geist/文楷与关于 UI 接入；桌面 API 已提供 public developer 和运行版本。

设置采用 schemaVersion 和 revision；损坏或未来版本保持原样，显式 v0 格式迁移先保存 `.v0.bak`。旧 localStorage 笔记由 C 的用户触发导入流程提交，不自动清理。回滚前备份原型 localStorage、userData 的设置/密文以及 PostgreSQL 数据和迁移版本。safeStorage 密文绑定原 Windows 安全上下文，不能视为可跨机器迁移的 API key 导出。

## 项目结构

```text
electron/                主进程、preload 和桌面资源协议
src/app/                 页面、布局与全局主题
src/components/ui/       从 shadcn/ui registry 引入的基础组件
src/features/knowledge/  笔记模型、存储接口、编辑器和工作区
src/lib/                 公共工具和桌面桥接类型
scripts/                 开发、预览与本地运行时脚本
tests/                   业务测试、浏览器测试、桌面冒烟测试
docs/                    架构、后续计划与初始化记录
```

## Git 工作流

每完成一个独立阶段，执行相关检查后创建本地提交，约定写在 [AGENTS.md](AGENTS.md)。

原型已分阶段保存，平台改动均交付在 `feat/desktop-platform`，交由 CTO 合并；不推送远程、不改写历史。当前权限配置允许 Git 写入。旧 `commit-initialization.mjs --apply` 的历史 fingerprint 已失效，不要再运行；阶段提交与证据见 [验证报告](docs/validation.md)。

原有 Prime Agent 工具继续保留，并从业务工程 Git 跟踪和格式检查中忽略。
