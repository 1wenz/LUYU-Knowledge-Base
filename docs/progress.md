# 初始化记录 · 2026-10-14

| 阶段 | 内容                                                  | 状态                           |
| ---- | ----------------------------------------------------- | ------------------------------ |
| 1    | Git 仓库、忽略规则、协作约定                          | 已提交：`0d1581b`              |
| 2    | Next.js、TypeScript、Tailwind CSS、依赖锁文件         | 源码与快照已保存，Git 提交待补 |
| 3    | Electron 主进程、沙盒 preload、静态资源协议、开发联调 | 源码与快照已保存，Git 提交待补 |
| 4    | shadcn/ui、知识库工作区、持久化、业务与集成测试       | 源码与快照已保存，Git 提交待补 |
| 5    | 完整校验、文档、本地运行时和阶段提交脚本              | 源码与快照已保存，Git 提交待补 |

## 已完成的校验

- `npm run check`：Web / Electron TypeScript 与 ESLint 通过。
- `npm test`：7 项业务测试通过。
- `npm run build`：Next.js 静态导出与 Electron 编译通过。
- `npm run format:check`：通过。

浏览器与桌面集成测试脚本已经建立，尚未执行通过。Playwright 启动子进程被当前会话拒绝（`spawn EPERM`）；浏览器连接器没有可用浏览器，额外预览进程启动也被自动审批策略拒绝。Electron 官方二进制下载没有完成：出现连接超时，当前安装缺少 `node_modules/electron/dist/electron.exe`。以上限制不等同于业务测试或桌面冒烟测试通过。

在普通终端中启用符合要求的运行时后，可安装依赖、下载测试浏览器，再执行集成检查：

```powershell
. .\scripts\Use-LocalRuntime.ps1
npm ci
npx playwright install chromium
npm run build
npm run test:browser
npm run test:desktop
```

## 补齐阶段提交

Git 初始化后，当前沙盒将 `.git/` 保护为只读，后续 `git add` 无法创建 `.git/index.lock`。提升权限请求也被自动审批策略拒绝，原因是本会话禁止申请沙盒权限。

各阶段的精确源码快照与 SHA256 校验清单保存在本机忽略目录 `.cache/init-phases/`。补提交脚本会检查快照与当前源文件、Git 分支和历史，逐阶段写入 Git 索引并创建独立提交；不会改写工作区文件或已有提交，不会推送远程。若源码已被继续修改或 Git 历史发生变化，脚本停止，需手动审查提交。

请在能写入 Git 的普通 PowerShell 中运行：

```powershell
. .\scripts\Use-LocalRuntime.ps1
node scripts/commit-initialization.mjs --dry-run
node scripts/commit-initialization.mjs --apply
```

四个待补提交：

1. `chore: scaffold nextjs typescript and tailwind`
2. `feat: add secure electron shell and development workflow`
3. `feat: add shadcn knowledge workspace and local persistence`
4. `chore: finalize initialization checks and documentation`

在补提交完成之前保留 `.cache/init-phases/`。以后继续按 [AGENTS.md](../AGENTS.md) 中的约定，每个独立步骤完成检查后立即创建本地提交。
