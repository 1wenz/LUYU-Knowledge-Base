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

## B1 设置、秘密和诊断

设置位于 userData/settings.json，schemaVersion=1、revision 乐观并发、组级替换、临时文件 fsync 后 rename。损坏和未来版本不覆盖；仅支持显式 v0 settings 包装格式迁移，原文件先备份为 `.v0.bak`。不存在文件时返回默认值，首次修改才写入。单实例进程内串行写入；不支持外部程序同时改写设置文件。

凭据位于独立 credentials.json，仅写 safeStorage 密文；加密不可用时拒绝 encrypted，session 只存内存。删除和切换 session 会先移除旧密文，写入失败保持原状态。没有秘密读回 IPC。常规日志只保留白名单事件、错误码、requestId、耗时、计数。

2026-10-16：18 项测试和 `npm run check` 通过。测试先确认平台模块缺失导致失败，再验证 revision 竞争、UTF-8 限制、损坏/迁移备份、写入失败、删除后重启、加密不可用、会话模式和合成秘密脱敏。

Electron 官方下载器本次 `fetch failed`，直接 GitHub 连接超时。正在复用本机已启用的系统代理进行进程级重试，没有修改全局代理或运行时；下载结果与真实桌面检查在 B2/B3 更新。
