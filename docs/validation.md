# Agent2 桌面平台验证记录

工作分支：`feat/desktop-platform`。独立 worktree：`D:\Warp\demo\.cache\agent2-platform`。交付给 CTO 本地合并，不推送远程、不自动合并其他 agents。

## 原型基线

2026-10-16 使用 Node 22.22.0 / npm 10.9.2。原工作区 check 和 build 通过；npm test 被同时新增但尚未实现的 A 测试阻塞，原型 7 项业务测试单独编译运行通过。建立独立 worktree 后，npm test 原有 7 项全部通过。原目录的其他 agent 文件未复制。

保存提交：`e1ebf13`（权限切换前已落到 main 的 Next.js 原型保存提交，保留历史）；其余原型和后续平台提交均在 `feat/desktop-platform`。不要运行旧 `commit-initialization.mjs --apply`，其历史 fingerprint 已失效。

## M0 公共基线

新增严格公共 schema / client / service 注入类型、完整测试发现和独立 Electron bundle。新增依赖锁定 zod 4.6.7、esbuild 0.28.2、sharp 0.35.5；将 ESLint 调整为 Next 插件支持的 9.39.5，消除原 10.x 的 peer 冲突。Next/React/Electron/Tailwind 版本保持原有基线。

契约行为测试先确认因为缺少 contracts 模块失败，随后实现。2026-10-16 顺序执行 `npm run check` → `npm test` → `npm run build` 全部通过：12 项业务/契约测试，Next 静态导出成功，main/preload 独立 bundle 成功。此时 preload 保留原型只读入口，完整固定客户端在 B2 接入。

## 集成边界

A 的 PostgreSQL/检索服务和 C 的新 UI 不在本分支的实现范围。终验收的混合检索、助手引用、设置 UI 与真实数据库流程需要 CTO 合并两路后验证。没有凭据、独立数据库或用例时不会把 db/live eval 标为通过。
