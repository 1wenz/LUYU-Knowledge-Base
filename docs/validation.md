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

Electron 官方下载器最初 `fetch failed`，直接 GitHub 连接超时。随后复用本机已启用的系统代理进行进程级重试，官方二进制安装成功；没有修改全局代理或运行时。真实桌面检查见 B2/B3。

## B2 安全 IPC 与生命周期

实现 `createPlatform(deps)`，服务工厂类型是 `KnowledgeServiceFactory`。CTO 合并 A 后在 `electron/main.ts` 的 createPlatform 调用中注入 `createKnowledgeService`；未注入时知识端点返回 CONFIG_REQUIRED，不创建 demo 资料。C 直接使用 window.desktop 的 KnowledgeClient。原型 UI 尚待 C 替换，不能用它证明 v1 的数据库/检索已联通。

所有固定 handler 经过注册 WebContents、顶层 mainFrame、精确 origin、请求字节上限和严格 schema；输出同样验证，非法服务响应变成 INTERNAL。preload 只包含本地 JS 和 Electron require，不开放 invoke。开发/生产导航、弹窗、权限、webview、CSP、静态路径穿越/Windows ADS 均受限；原生文本选择器限定扩展名、UTF-8、数量、单文件与总字节。

长任务以 Command.requestId 登记，先发送 started，seq 从 1 递增，终态唯一；delta 最多每 50ms 一次、16 KiB 每块。owner 从注册窗口推导，跨窗口取消拒绝；关窗/导航取消。搜索替换与数据库/凭据切换会取消旧 signal，旧成功响应再次按连接 epoch 拒绝。设置只调用 A 的 applySettings，不启动重建。A 的 applySettings 即使前后设置相同也必须重新读取秘密，关闭旧连接池；失败后平台阻止新数据操作，设置仍可编辑。LangChain/LangSmith tracing 在主进程关闭。

2026-10-16：check 与 build 通过；31 项单元/平台测试通过。真实 Electron 4 个用例均已验证：静态沙盒/旧兼容入口；固定 API 与输入攻击；Windows safeStorage 设置/删除跨三次重启；同源未注册窗口拒绝和导航/弹窗阻止。最后一项最初因测试从 getLastWebPreferences 读取不到 preload 路径而超时，夹具改用应用根目录明确路径后单项复验通过，未放宽应用安全参数。流式时间断言使用 mock clock，避免负载导致定时等待不稳定。

Electron 44.7.2 官方二进制经本机已有系统代理的进程级设置安装成功。测试使用独立 `.cache/desktop-tests/user-*` userData，不接触用户正式配置或笔记。截图 `.cache/desktop-preview.png`，失败 trace 留在忽略的 test-results（后续测试会更新）。

## B3 Windows 窗口、品牌与目录包

2026-10-16，在 Windows 10.0.26200 x64 验证。构建工具为 Node 22.22.0 / npm 10.9.2、electron-builder 26.15.3；实际 Electron 44.7.2 内运行 Chrome 152.0.7977.149 / Node 24.21.0。正式 appId `com.zhiyu.knowledgebase`、productName `Zhiyu` 与原 userData 路径保持兼容；测试仅覆盖显式隔离的 userData。

原生标题栏通过 Windows SendInput 实际鼠标拖动，未用 setBounds 代替。目录包记录 bounds 从 `{x:0,y:0,width:1280,height:752}` 移至 `{x:70,y:43,width:1280,height:753}`；当前桌面工作区限制了设计初始 1380×900 的实际大小。最大化后“新建笔记”按钮、对话框文本输入、Escape 和还原正常；关闭后记录的 Electron 主进程/辅助进程全部退出。拖动测试最初误用 Playwright 启动包装进程的 PID，严格 HWND/PID 检查拒绝操作；改为 Electron 主进程的实际 `process.pid` 后通过，未放宽窗口归属校验。

从 `public/brand/brush.svg` 生成 16/24/32/48/64/128/256 PNG 帧的 ICO、favicon 和 1200×630 OG 位图；源 SHA-256 为 `f7d9e322d7625f9c3573212ae4a1dc551aede745fbdca681e04dec68c3b2645e`。构建时生成至 `.cache/branding/`，静态资源复制到 out；源码、产物和 logo 同源。抽取实际 EXE 32×32 图标及窗口 256×256 原生图标并目视检查，墨色轮廓交并比分别为 0.9859 / 0.9881（门槛 0.8）。

`npm run package:dir` 已生成并实际启动 `release/win-unpacked/Zhiyu.exe`，PE 头确认 x64。main/preload 为自包含 bundle，构建检查 preload 仅有 Electron 外部依赖，main 仅有 Electron/Node 内建；目录包排除 node_modules，使用 knowledge://app 静态协议启动，没有 Next.js 生产服务器。

EXE 文件属性为 ProductName/FileDescription=`Zhiyu`、ProductVersion=`0.1.0.0`、CompanyName=`未配置`、LegalCopyright=`开发者未配置`。electron-builder 26 将 FileDescription 写为 productName，中文业务描述保留在 package.json。检查曾发现 extraMetadata.author 字符串导致 CompanyName 残留 Electron 的 GitHub, Inc.，已改为 `{name: ...}`，重新打包后确认修复。Get-AuthenticodeSignature 结果为 `NotSigned`，不具备已签名发布验收或 SmartScreen 信誉证明。

| 检查                       | 本次结果           | 范围与证据                                                                                                  |
| -------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `npm run check`            | 通过               | Web、Electron、E2E 类型与 ESLint                                                                            |
| `npm test`                 | 31 项通过          | 原型业务、契约与平台行为；不含 A 的数据库/检索实现                                                          |
| `npm run build`            | 通过               | 图标、Next 静态导出、独立 Electron bundle 与静态品牌资源；package:dir 中再次执行成功                        |
| `npm run package:dir`      | 通过               | Windows x64 目录包生成；未构建 NSIS 安装包                                                                  |
| `npm run test:desktop`     | 5 项通过           | 构建源码的完整桌面回归，包含 SendInput 拖动与退出清理                                                       |
| `npm run test:package:win` | 5 项通过           | 实际目录包的沙盒/preload、参数攻击、safeStorage 跨重启、未注册窗口、拖动/输入/进程退出；另验 EXE 属性与图标 |
| `npm run test:browser`     | 3 项通过、1 项失败 | 当前分支初始化原型，Chrome；并非 C 的 Fluid UI 验收                                                         |

浏览器失败位于 `tests/browser/knowledge.spec.ts:48`：损坏数据用例的 `getByRole("alert")` 同时匹配业务错误提示与 Next 的 `__next-route-announcer__`，触发 strict mode violation。实际业务提示包含“写入已暂停”，但后续按钮/原数据断言未执行。该文件由 Agent C 负责；C/CTO 合并 UI 时应把定位限定到包含“写入已暂停”的业务 alert，再验证禁用写入和损坏原文保持，不删除 Next 的无障碍播报器或降低断言要求。

证据在本 worktree 的忽略目录：`.cache/windows-package-report.json`（EXE 属性、签名、轮廓比对、目录包测试结果）、`.cache/package-desktop-drag.json`、`.cache/package-desktop-runtime.json`（目录包记录副本）、`.cache/desktop-drag.json`、`.cache/desktop-runtime.json`（最近源码桌面回归）、`.cache/package-exe-icon.png`、`.cache/window-native-icon.png`、`.cache/branding/manifest.json`。浏览器失败 trace 已保留为 `.cache/browser-damaged-data-trace.zip`，因为后续 Playwright 命令会重建 test-results。所有包、用户数据、图片与 trace 均不进入 Git。

公开开发者 name/homepage/repository/support/copyright 尚未提供，API 返回 null；package/Windows 属性使用“未配置”，license 为 MIT。构建只读取显式公开环境变量，清单见 `.env.example`；不自动读取凭据环境文件。`release:check` 单独报告资料缺项，实验目录包允许未配置生成，正式发布应先运行该门禁。字体、页面 metadata/noindex、关于 UI 和完整检索链需 CTO 合并 A/C 后验证，不能以本分支的原型测试替代。
