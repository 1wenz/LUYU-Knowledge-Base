# Agent B 任务书 · Electron 平台、公共基线与最终集成

你负责让三条工作流有稳定接口，并将数据服务和 Fluid UI 集成为安全、可拖动、可配置、可打包的 Windows Electron 应用。你也是最终集成负责人，M0 之后与 A/C 并行推进平台工作。

## 开始前与独有范围

先读根 `AGENTS.md`、`Designlang.md`、架构、契约、开发原则和本目录 README。检查当前工作区；大量原型文件可能未进入 HEAD，禁止直接建空基线后让其他 agent 重写项目。

你拥有 `src/lib/contracts/**`、`src/lib/desktop.ts`、`electron/main.ts` / `preload.ts` / `composition.ts`、`electron/platform/**`、`electron/ipc/**`、`tests/contracts/**`、`tests/platform/**`、`tests/desktop/**`。

你唯一维护 package/lockfile、Electron/Next/TS/Playwright 根配置、`scripts/**`、`.env.example`、CI、`.gitignore`、顶层 README/AGENTS/架构/契约和 `docs/validation.md`。A 的知识服务/SQL、C 的 UI/浏览器测试由各自修复，不顺手大改。

## B0 / M0 · 公共基线先行

1. 保存 Git 状态，区分原型源码、用户其他修改与生成/本地文件。保持原 Prime Agent 工具；不 `git add .`。
2. 审查已有原型、记录现有检查结果，按照已有阶段把可归属原型文件提交为基线；保留未知用户修改，不重写历史、不推送。旧补提交脚本依赖历史/内容 fingerprint，不得直接 `--apply`。
3. 从 `contracts-v1.md` 落实公共 DTO、schema、client 和事件定义。补齐 AppInfo/IndexStatus 等附属字段，并把精确 TypeScript API 发给 A/C；不放任何秘密字段。
4. 设置 test runner 的发现范围，当前只列一个 domain 文件的脚本必须修正；保证新增 A/B/C 测试会实际运行。
5. 修正 Electron 编译：main 和 preload 单独 bundle，tsc 独立检查共享代码及嵌套文件。preload 不能因为引入庞大 schema/SDK 而突破沙盒 require 限制。
6. 集中接受 A/C 依赖请求，检查当前 Next/React/Electron/Tailwind/Fluid/LangChain 兼容性并锁版本；不要无需求大规模升级已有框架。
7. 提交 M0，公布完整 baseline commit、依赖提交、类型入口和命令。三条 worktree 从同一起点并行，不能共享 `.next`、Git index 或 userData。

M0 检查包括原有业务测试、公共类型/schema 测试、check 和 build。若二进制下载或环境阻塞，记录具体错误和影响，不把旧记录直接沿用成当前事实。

## B1 · 设置、秘密与连接生命周期

settings 服务使用带版本和 revision 的 `userData/settings.json`，原子写入；先测试损坏文件、旧版本迁移、写入失败和并发 revision，再写实现。返回公开 SettingsView，不暴露密码 DSN。

秘密在 Windows safeStorage 加密单独保存；检测不可用时只支持 session 内存状态，明确返回 `ENCRYPTION_UNAVAILABLE` 或 session 模式，不写明文。删除秘密后重启仍不存在；保存失败不假装成功。测试使用合成秘密，检查整个 DTO/事件/日志中都不包含它。

数据库默认 loopback，远程必须证书验证；提供连接测试、公开状态和脱敏诊断。更换连接时调用 A 的 applySettings，取消旧连接相关操作、关闭旧 pool；不能让新旧连接结果混入同一页面。

提供 settings 更新的 `requiresReindex`，重建必须由 UI 显式触发；频繁保存温度不能重新 embedding。更新后返回完整快照。主进程 config 不暴露用户本机路径，tracing 默认关闭。

阶段提交建议：`feat: add encrypted credentials and validated settings`。

## B2 · 安全 IPC 与服务组装

在 composition 创建 A 的 `createKnowledgeService`，注入已验证的设置、只读秘密访问、logger、事件 sink；A 不依赖 Electron。你维护来源、operationId、owner 和 AbortController registry。

所有 handler 检查 sender 对应已注册主窗口、顶层 main frame 和精确 origin，并做请求 schema/上限校验。preload 暴露固定方法和经过 schema 验证的事件；不暴露任意 invoke、SQL、文件路径或 Node。保留原只读 app:get-info 兼容入口，待相关测试迁移后再清理。

搜索取消、助手/重建长操作、事件 seq/终态和窗口关闭清理都必须实现。使用已验证的 Command.requestId 作为 operationId，UI 登记并订阅后再启动，首事件不能因响应竞态丢失；owner 从 sender 推导，禁止不同窗口窃听/取消彼此任务。模块退出关闭连接池、worker、listeners，防止进程残留。

保持 contextIsolation、sandbox、nodeIntegration:false、webSecurity。继续限制生产协议路径穿越、请求方法、导航、弹窗、权限和 CSP；修改协议应增加编码路径和不存在文件测试。外链只打开经过验证的 http(s)，文本文件只经原生选择器和大小/扩展名/编码限制读取。

必须有负向测试：伪造/iframe IPC、未知 channel、超长输入/错误枚举、path traversal、别窗取消、恶意外链、秘密回读与日志脱敏。不要为通过测试移除 origin 判断或给 connect-src 放开所有域名。

阶段提交建议：`feat: wire secure knowledge ipc and operation lifecycle`。

## B3 · Windows、拖动、图标和开发者信息

v1 保留原生 `frame:true` 标题栏、现有 appId / productName 和 userData 路径。窗口初始/最小尺寸遵循设计，不能为视觉稿改为全窗 drag 区。C 的输入/按钮/浮层正常点击不影响原生标题栏拖动。

桌面回归测试记录拖动前后的窗口 bounds。可以使用受控的 Windows SendInput 测试助手拖动原生标题栏，不能把直接调用 setBounds 当作鼠标拖动验证；自动化不可用时真实手动验证并明确记录。

从 `public/brand/brush.svg` 同源生成多尺寸 Windows ICO（16/24/32/48/64/128/256）和必需的 favicon/OG 位图，产物进入忽略目录并在打包前生成。检查实际 `.exe` 图标、窗口图标与 UI logo 一致；不能只设置 package icon 字段。

补齐 package author/description/homepage/license、builder metadata、版权、Windows 文件信息与关于数据入口。真实开发者资料未知时用显式配置/“未配置”，发布门禁报告缺项，不能编造邮箱或域名。未签名实验包记录未签名，不声称具备 SmartScreen 信誉。

只编译 Windows x64，`package:dir` 及 NSIS 目标显式 `--win --x64`。核对现有排除 node_modules 的打包配置：bundle 自包含或携带 external runtime deps；在 package 目录实际运行才能算通过。字体和静态资源离线加载，Next 不启动生产 Node server。

阶段提交建议：`feat: complete windows shell branding and packaging`。

## B4 · 集成、门禁和交付

先集成 A 服务与契约，再接 C 的真实 desktop client。浏览器 demo 有模式标签，不能用 demo 填充桌面生产环境掩盖断联。共享文件冲突由你顺序解决，遇到业务/UI问题让原负责人修复所属范围。

完成以下命令入口与报告（已存在的名称保持兼容）：

- `npm run check` → `npm test` → `npm run build`，按顺序执行。
- `npm run test:db`，独立测试库/随机 schema，确实执行 A 的数据库用例。
- `npm run test:browser`，C 的业务/设置/无障碍行为。
- `npm run test:desktop`，真实沙盒、IPC、秘密、窗口生命周期与拖动。
- `npm run package:dir` 和 `npm run test:package:win`，实际运行目录包。
- `npm run eval:live`，只在 RUN_LIVE_EVAL、两家 key、EVAL_DATABASE_URL 和预算就绪时运行，不向日志写密钥；缺配置明确标未执行。

用项目内 `. .\scripts\Use-LocalRuntime.ps1` 启用现有 Node 22，不改变用户全局 runtime 或代理。`npm ci`/下载二进制失败和 spawn EPERM 需要报告本次真实错误；不能禁用 sandbox 或跳过类型检查解决。

`docs/validation.md` 记录运行版本、命令、通过/失败/未执行、证据路径、schema/eval 数据集版本、Windows 包行为、开发者信息缺项与后续步骤。截图、包、日志、数据库和结果 JSON 留在忽略目录，提交文档和源代码。

终验收路径：新建资料 → 混合搜索与 Rerank → 片段打开 → 助手引用 → 模型/温度保存 → embedding 维度重建 → 断网降级 → 重启配置与笔记保留 → 拖动/最大化/点击正常 → Windows 目录包重复该路径。

每阶段相关检查后立即本地 Conventional Commit。最终交付包含依赖与提交清单、运行说明、数据升级/备份、测试/eval报告和明确限制，不自动推送或发布。
