# 知屿 · Knowledge Base

使用 **Electron + Next.js App Router + shadcn/ui** 构建的本地优先知识库桌面工程，使用 TypeScript 和 Tailwind CSS。

初始化包含分类浏览、标题/正文/标签搜索、新建与编辑笔记、收藏、删除，以及带版本校验的本地持久化。界面示例数据用于验证工作流；存储通过独立接口访问，后续可替换为 SQLite。

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

该运行时不是仓库依赖；新克隆项目请安装符合版本要求的 Node。

## 常用命令

| 命令                   | 用途                                             |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | 同时启动 Next.js 和 Electron                     |
| `npm run dev:web`      | 浏览器开发，地址 `http://127.0.0.1:3000`         |
| `npm run check`        | Web 与 Electron 类型检查、ESLint                 |
| `npm test`             | 存储和知识库业务测试                             |
| `npm run build`        | Next.js 静态导出 + Electron 编译                 |
| `npm run preview`      | 预览静态导出，地址 `http://127.0.0.1:3100`       |
| `npm start`            | 打开已构建的 Electron 应用                       |
| `npm run test:browser` | Playwright 浏览器交互测试，需要先构建            |
| `npm run test:desktop` | Electron 静态页面与 preload 冒烟测试，需要先构建 |
| `npm run package:dir`  | 生成未安装的桌面打包目录                         |
| `npm run package`      | 生成 Windows NSIS 安装包                         |
| `npm run format:check` | Prettier 格式检查                                |

浏览器测试首次运行需安装 Chromium：

```powershell
npx playwright install chromium
npm run build
npm run test:browser
npm run test:desktop
```

也可使用已安装的 Chrome：`$env:PLAYWRIGHT_CHANNEL = 'chrome'`。

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

本次初始化的第一阶段已提交；后续写入 Git 索引被当前会话沙盒阻止，自动提升权限请求也被拒绝。阶段快照在本机的 `.cache/init-phases/`，补提交脚本见 [初始化记录](docs/progress.md)。源码和检查结果已经保留，不能把未提交阶段视为已有 Git 提交。

原有 Prime Agent 工具继续保留，并从业务工程 Git 跟踪和格式检查中忽略。
