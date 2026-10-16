# UI 组件、资产与 Agent C 交接记录

Agent C / agent3；分支 `feat/fluid-workspace`，独立 worktree `D:/Warp/zhiyu-c-ui`。本文只记录已经核实的来源与实施状态，截图或 demo 不代表真实桌面链路已通过验收。

## 当前阶段与集成边界

2026-10-16：完成设计文件、原型和冻结契约阅读。原型使用 localStorage、硬编码分类与同步编辑接口；它不满足 v1 的 PostgreSQL 持久化、软删除、revision、来源检索或助手要求。原型 repository/model 暂留兼容，避免破坏既有业务测试和旧数据。

准备阶段从 `e1ebf13` 建立独立分支，只提交 C 所属的来源记录和获许可资产。已合入包含 B 的 M0 `34157d2` 的基线 `98c3d9f`。不复制公共 DTO，不修改 package/lockfile、Electron、共享类型或根脚本。所有提交留在此分支，供 CTO 合并。

C1 增加 `/design-preview/`，作为有明确静态样例标识的独立展示与测试入口。首页原型保留，C2 再接统一 client。当前 Button、SidebarMenu、InputMessage、ChatMessage、Dialog 和 TabsSubtle 是逐项审查后的精简适配：保留内层按钮表面/按压、选择与悬停分离、IME、流式稳定换行、Radix 焦点和键盘语义；删除本轮不支持的队列、附件、peek/resize 等功能。C1 使用局部 CSS 动效，没有新增运行时依赖；完整 Motion 变体待 B 锁定依赖后再评估，不能称为未改动的上游全量安装。

### 给 B 的依赖请求

| 依赖                           | 用途                                                                        | 兼容要求 / 备注                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `motion`                       | Fluid Sidebar、TabsSubtle、InputMessage、ChatMessage、Dialog、Select 等组件 | 官方 registry 使用 `motion/react`；需兼容 React 19、Next 静态导出，由 B 验证并锁定版本 |
| `react-markdown`、`remark-gfm` | 笔记与回答 Markdown 安全预览                                                | 禁用原始 HTML；图片不发网络请求；外链由 `KnowledgeClient.system.openExternal` 打开     |
| `@axe-core/playwright`（dev）  | 主要页面自动无障碍检查                                                      | 与现有 Playwright 版本兼容；自动检查之外仍验证焦点、字体、对比度                       |

现有 `radix-ui`、`lucide-react`、`class-variance-authority`、`clsx`、`tailwind-merge` 可复用。Fluid 的 `@radix-ui/react-*` import 可等价映射到已安装统一包的命名导出。暂不引入 `@base-ui/react`：其 `InputGroup` 依赖另一套 primitive，不用于本项目。`file-thumbnail` 间接依赖 `pdfjs-dist`，本轮不支持 PDF/附件预览，接入时仅保留文件名与 Lucide 类型图标，不引入 PDF worker。Border Beam 用局部 CSS，无额外依赖。C 不执行会修改共享依赖或锁文件的安装。

## Fluid 源码审查

来源：<https://www.fluidfunctionalism.com/r/registry.json>，仓库 <https://github.com/mickadesign/fluid-functionalism>。2026-10-16 参考 revision：`d5c36065b8a351a3f248b496b03b2bdcef58d682`。许可证为 MIT，原文保留于 `public/licenses/fluid-functionalism-MIT.txt`。按项读取公开 registry；没有运行整站安装或生成 prompt。

| 组件 / registry                       | 拟用位置                     | 审查发现及接入要求                                                                                                |
| ------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sidebar`（Radix）                    | 工作区、分类、标签与视图导航 | 使用 Drawer/Dialog primitive；保留焦点约束；调整 224px 侧栏和中文字号；选择态与悬停层分开                         |
| `tabs-subtle`（Radix）                | 笔记/来源、编辑/预览         | 保留真实 Tabs 键盘语义、可中断选择动效                                                                            |
| `input-message`                       | 助手输入、发送、停止         | 原源码已检查 `nativeEvent.isComposing`；禁用队列与文件拖放等本轮无后端支持的功能；保留消费者可访问标签            |
| `chat-message`                        | 用户问题与助手回复           | 流式回答不使用 text-pretty 反复重排；动作可键盘聚焦；应用 reduced motion 由 provider 统一控制                     |
| `thinking-indicator`                  | 真实检索/生成阶段            | 原版每 4 秒轮播 Thinking/Moonwalking 等，与实际处理无关；接入时移除轮播，文案只来自 OperationEvent；图形改 Lucide |
| `dialog`（Radix）                     | 编辑、导入、确认和紧凑视图   | 保留关闭与焦点恢复；入口控件须保留引用；中文错误允许换行                                                          |
| `select`（Radix）、`switch`、`slider` | 设置                         | 数字始终同时提供可键入字段和单位；共享 schema 提供范围与跨字段验证                                                |
| `button`、`tooltip`                   | 通用操作                     | 控件至少 40px，图标按钮至少 36px；所有图标按钮中文 aria-label；tooltip 不替代标签                                 |

组件进入 `src/components/ui/`；Fluid 共享 utility/hook 放在该目录下的明确子目录，由 C 维护，不写入 A/B 的 `src/lib` 所属路径。只引入选中组件及其必要依赖，保留 MIT 声明与来源。默认图标适配为命名导入的 Lucide；不另下图标集。所有浏览器测量、Observer 与 window 访问须在 effect 或事件内，验证静态构建与首次 hydration。

### 获取时的 registry SHA-256

这些哈希用于核对审查时的公开 payload；未来更新需重新审查，不能用当前线上文件覆盖本地修改。

| registry           | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| sidebar            | `736941cbe21ab411b71fea4889c47bf2def2acc6dd89bfe9881fb183a10c567b` |
| input-message      | `1f1f61f0589fba2db19d51acec79575061be58e96abe0b4ec48557e7f2424e24` |
| chat-message       | `4ed43b9471d26943ddf9a8594de33a5cdcf39d25e63465ab1bf8fc72c5bed3dd` |
| tabs-subtle        | `8686e2d526fefe3b0f384ae316148b6c8920ac1e352b57de5f5319f786350409` |
| thinking-indicator | `22770b3063e699dd33d69f22f47cf85dad74db3d7e12a65df3a6e4882af0aaf2` |
| dialog             | `dd79d9c1e802e3b898c4854850c07c6d6d1aceffa508ade1ae83bff8e503fc97` |
| select             | `820e8dee605b8bafecc1ba9f62b206bc591c55ffb1f44679055838d2655b17ef` |

## 本地字体与品牌资产

字体是获许可的源资产；不依赖运行时 CDN，不提交构建缓存、运行时生成子集或生成图标。中文禁用伪粗体，字号与墨色提供层级。

| 文件                                     | 来源与版本                                                                                             | 真实字重                   | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `public/fonts/geist/Geist.woff2`         | vercel/geist-font `10dc7658f13c38a474cde201bb09a4617267545b`，`fonts/Geist/webfonts/Geist[wght].woff2` | variable，以字体元数据为准 | `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1` |
| `public/fonts/geist/GeistMono.woff2`     | 同 revision，`fonts/GeistMono/webfonts/GeistMono[wght].woff2`                                          | variable，以字体元数据为准 | `afaacc4c5fbba89d2ebf7a02dc4070208540874592a5504d57175782fe893101` |
| `public/fonts/lxgw/LXGWWenKaiScreen.ttf` | lxgw/LxgwWenKai-Screen `v1.522` 官方 release 原始文件，25,673,994 bytes                                | 400                        | `cd1a6fa39c4ea42fd8f4e289945789b0e510cf7016435640f8893cdad9b220f3` |

Geist 和文楷各自的 OFL 原文与字体同目录保留。文楷许可证取自 upstream revision `34f2c5602eb51d7455a0032c56ea9b0029edab53`。完整 TTF 保留上游字形覆盖，避免自行生成的中文子集漏字；25MB 为安装包资产体积成本。界面只预载首屏所需字体，Geist Mono 在代码内容使用时加载。

品牌唯一源是 `public/brand/brush.svg`。UI 可用同源 CSS mask 继承 currentColor；邻接“知屿”文字时隐藏装饰的可访问名称。Windows 图标生成由 B 负责。

## 必须覆盖的状态与验收入口

| 视图       | 状态 / 行为                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 客户端入口 | 初始化、桌面 API 缺失错误、明确浏览器 demo；不静默降级                                                          |
| 笔记       | 加载、空库、正常、未保存、保存失败、revision 冲突、回收站、恢复、文件/旧数据导入和重复导入                      |
| 来源搜索   | 300ms debounce、取消、慢响应淘汰、无匹配、数据库离线、关键词降级、Rerank 失败、向量待完成、行定位和返回上下文   |
| 助手       | 未配模型/key、检索中、来源先展示、生成中、停止、失败后重试、旧 operation/seq 忽略、唯一终态、滚动跟随与向上阅读 |
| 设置       | 以组提交、expectedRevision、范围/跨字段错误、冲突重载、密钥提交/关闭清空、加密/会话状态、显式开始/取消重建      |
| 共通       | Ctrl+K、Ctrl+,、Escape、IME Enter、Shift+Enter、焦点恢复、dark、系统/应用 reduced motion、长文本、无障碍检查    |

尺寸验收：1380×900、960×640、390px 浏览器、125% Windows 缩放和 200% 页面缩放。截图/报告写入忽略的 `.cache`；桌面原生标题栏实际拖动由 B 验证。

## 验证记录

准备阶段：fontTools 校验 Geist / Geist Mono 为 100–900 variable，文楷为真实 400；中文代表字形和 OFL 文本检查通过。上游许可正文只清理了行尾空格并补文件末尾换行，许可含义未变。

C1：本地字体、颜色/字号 token、同源毛笔、私人工作区 noindex 和输入 Border Beam 已接入。实测 input 边界后同步修正 Designlang 的对比度。系统与应用减少动态效果均禁用循环边框并保留静态焦点。

2026-10-16 的已执行结果：`npm run check` 通过；`npm test` 12 项通过；`npm run build` 通过（静态导出 `/`、`/design-preview/` 及独立 Electron bundle）；`PLAYWRIGHT_CHANNEL=msedge npm run test:browser` 12 项整体通过（8 项新展示行为 + 4 项原型回归）。独立 worktree 使用原仓库 Node 22.22.0 / npm 10.9.2 激活脚本；本分支不复制或修改全局运行时。首次 IME 测试在展示页缺失时失败，之后补实现；开发环境启动/默认 Node 16/预览端口和测试定位的失败已排除，最终以生产导出测试为准。原型损坏数据提示的定位补充内容筛选，排除 Next 的空 route-announcer，保留不覆盖原数据的断言。

生产预览针对 IME、发送/空输入、焦点恢复、Ctrl+K / Ctrl+,、深色和 reduced motion、1380×900 / 960×640 / 390×844、本地字体、noindex、200% CSS 缩放进行行为测试。CSS 缩放不等价于 Windows 125% 系统缩放，后者仍由真实 Windows 桌面验收补齐。

无障碍证据：axe-core 4.14.0 仅下载至忽略的 `.cache/ui-c1` 用于验证，按 npm SHA-512 integrity 核对，没有改共享依赖。浅色与深色页面各 24 项检查通过，WCAG 2 A/AA 与 2.1 AA 自动检查 0 项违规；CDP `CSS.getPlatformFontsForNode` 确认中文标题实际使用自定义 `LXGW WenKai Screen` 字形、拉丁品牌文字使用自定义 `Geist` 字形。代表性中文字体元数据检查通过，完整字库无缺字承诺仍需真实内容验证。

截图与报告：`.cache/ui-c1/light-1380.png`、`dark-1380.png`、`dark-390.png`、`accessibility.json`。人工截图曾发现侧栏管道转码成问号，已修正源文本并加入页面乱码回归检查。自动报告和截图不是整条真实知识库链路验收；C2–C4 仍需共享 client、A/B 服务和设置联调。

### C2 · 契约工作区与来源检索

新增 `src/features/workspace/` 与 `src/lib/client/`。默认浏览器入口要求主动选择演示；`/?demo=1` 使用独立 `zhiyu:demo:v1` 存储，首次为空，损坏时阻止打开并保留原内容。桌面要求完整的白名单 `KnowledgeClient`，缺失方法显示配置错误。`/?legacy=1` 仅保留原型回归与旧数据访问，不作为桌面入口。

笔记接入 documents/collections API，支持完整读取、以 revision 保存、收藏、回收站、恢复、分类创建/重命名、标签筛选和分页。列表筛选明确只针对已加载标题与摘要；来源检索独立使用 300ms debounce、请求取消和 requestId 淘汰。结果显示片段数量、真实 mode/warnings、时间与行号。来源弹窗读取当前笔记并核对 revision，版本变化时不高亮旧行；关闭恢复原来源按钮焦点与查询。

Markdown 使用 React 文本/元素实现有限基础语法（标题、段落、列表文本、代码块、粗体和链接），没有原始 HTML 执行入口。图片显示占位文本，外链只允许不含凭据的 HTTP(S) 并走 `system.openExternal`。文件选择走 `system.pickTextFiles`，审核后使用共享 import schema；源 hash 确保重复批次不创建副本。旧版导入只读原存储，任何失败都不删除源数据。保存冲突保留草稿，必须显式读取最新保存基线才能继续提交。

验证：初始三项入口/CRUD 测试先因缺少行为失败；实现后 `npm run check`、`npm test`（12 项）、`npm run build` 均通过。Edge 生产导出浏览器回归最终 23 项通过，包含慢查询不响应取消仍不能覆盖新结果、主动取消、数据库离线、重排降级、来源版本变化、重复文件导入、安全预览和损坏演示存储。首轮离线测试过早发送快捷键，补充等待工作区加载后全量复验通过。

测试 fixture 用现有 esbuild 在测试进程内打包真实 demo adapter，注入具有同一契约的受控 bridge；生产代码没有测试参数或全局测试入口。共享 DTO、Electron、依赖和锁文件未修改。当前仍依赖 B/A 完成真实桌面服务集成；浏览器证据不代表 PostgreSQL、云端模型或真实窗口拖动已经通过。

### C3 · 流式助手

`useOperation` 在 effect 中建立订阅，点击发送时先登记 operationId，再调用 start；校验 operation schema、id 和递增 seq，终态后忽略后续事件。context 中的引用必须逐字段匹配本次 SearchResponse hits；completed 引用同样受该白名单约束。真实事件驱动检索/生成阶段，流式 Markdown 复用安全预览。切换视图移除订阅并取消任务；主动停止可重发，失败可重试，模型/key 缺失指向设置。靠近底部时跟随文字，向上阅读后暂停跟随并提供回到最新回答按钮。

C3 验证：`npm run check`、`npm test`（12 项）和 `npm run build` 通过；独立 Edge 生产浏览器助手组 4 项通过。测试覆盖 IME、Shift+Enter、空问题、同帧双发送、停止后重发、启动失败恢复、未知 operation、重复 seq、终态后事件、伪造来源、来源打开和视图切换清理。初始来源流测试先因缺少助手输入失败。Border Beam 复用 C1 的聚焦/生成、no-drag 和 reduced motion 行为。

### C4 · 设置、重建与关于

`SettingsPanel` 只持有共享 `SettingsView` 的公开快照和当前编辑草稿；每个设置组通过 `settings.update({ expectedRevision, patch })` 单独提交，提交前使用同一 contracts schema 解析，冲突提示重新加载并清除本地草稿。数据库 host/port/name/user/TLS、模型 ID/能力、Embedding 维度、chunk/overlap、关键词/向量候选、权重、Rerank、温度、上下文和输出预算、主题及减少动态效果均有 label、单位和直接输入。远程数据库的证书约束由共享 schema 提供。

凭据使用独立 `SecretField`，值不会回填、写入 demo localStorage 或进入页面状态之外的可持久层；提交和删除后清空输入，只显示未配置/当前会话/系统加密状态。浏览器 demo 只能选择当前会话，桌面默认系统加密并由 B 的 safeStorage 决定可用性。模型列表、数据库/OpenRouter/Cohere 测试都必须点击，不在打开设置时自动发起 provider 调用；连接失败只展示公开错误。

向量维度或分块设置保存后只展示 `requiresReindex`。用户进入索引组点击重建，二次确认后由 `useOperation` 订阅 `progress/completed/cancelled/failed`，显示文档数、片段数、进度与失败数；取消时保留当前 active generation。关于页读取 `system.getInfo` 的版本、运行模式、架构和公共开发者资料，未知显示“未配置”；许可证按钮读取随包文本，外链仍走 `system.openExternal` 白名单。

C4 验证：`npm run check`、`npm test`（12 项）、`npm run build` 均通过；Edge 生产导出设置组 4 项通过。覆盖范围与跨字段错误、expectedRevision 冲突、密钥清除与不落 localStorage、显式重建确认/进度/取消、模型列表/连接探测按需触发、主题与 reduced motion 以及关于/许可证信息。未声称真实 PostgreSQL、safeStorage、provider 或 Windows 窗口集成已通过，需 B/A 集成环境补验。

### C5 · 最终浏览器与视觉验收（2026-10-16）

最终 `npm run check`、`npm test`（12 项）和 `npm run build` 按顺序通过；`PLAYWRIGHT_CHANNEL=msedge npm run test:browser` 全量 39 项通过。新增验收包含 1380×900 / 960×640 / 390×844 各主视图和所有设置组、200% CSS 缩放、未保存草稿的二次确认/焦点恢复、旧版导入与源数据保留、加密不可用后显式切换会话、索引未完成提示及流式长回答主动向上阅读。

验收曾发现 200% 缩放下媒体查询仍强制双栏，改为按工作区容器实际宽度切换；不通过隐藏水平溢出来掩盖布局。草稿嵌套确认关闭后焦点丢失，定位为 React 输入 autoFocus 先于 Radix 记录入口，改由 Radix 统一聚焦并在关闭后的下一帧恢复。保存后查询索引状态，主视图顶部显示 pending/failed/requiresReindex。助手错误状态停止 Border Beam，修改问题恢复输入。上述问题均由对应行为用例失败后修复，并全量复验。

复用已校验的 axe-core 4.14.0，在空库、编辑器、笔记、搜索、来源弹窗、许可证、浅/深色七组设置、深色助手和 390px 助手共 23 个状态运行 WCAG 2 A/AA + 2.1 AA 检查：全部 0 项违规，每状态 20–29 项检查通过。报告为 `.cache/ui-v1/accessibility.json`，截图同目录：`notes-light.png`、`notes-dark.png`、`search-light.png`、`source-light.png`、`editor-light.png`、`settings-light-0.png` 至 `settings-light-6.png`、`settings-dark-0.png` 至 `settings-dark-6.png`、`assistant-dark.png`、`assistant-dark-390.png`、`assistant-390-viewport.png` 等。审计脚本 `.cache/ui-v1/audit.mjs` 不进入产品代码/依赖。审计记录外部请求 0；reduced motion 下 Border Beam 的 animation 为 none、pointer-events 为 none。截图实际检查了文字、宽度和控件位置；CSS 缩放与浏览器截图不能代替 Windows 125% 系统缩放与真实标题栏拖动。

`npm run test:desktop` 已实际执行并失败（1 项）：Electron 可以启动，当前 M0 `electron/preload.ts` 只暴露原型 `getInfo()`，新入口因此显示“桌面接口尚未就绪”，原测试等待“全部笔记”超时。保留这一真实结果，不把测试改成等待演示或旧原型来隐藏缺失。完整 `KnowledgeClient` bridge、A 的服务以及同步后的桌面用例由 B/CTO 集成后重跑。数据库、provider、safeStorage、Windows 打包与实际拖动不在本分支声称通过。

### 给 CTO 的合并与联调入口

工作区 `D:\Warp\zhiyu-c-ui`，分支 `feat/fluid-workspace`。阶段提交：设计系统 `91eb6d7`；笔记/来源检索 `e3fc75c`；助手 `df86893`；设置 `3a27137`。基于已发布的 M0 `34157d2` 与资产基线 `98c3d9f`，没有修改公共契约、Electron、package/lockfile、根脚本或 A 的服务；无需新增依赖。C5 后续提交只涉及 UI 与浏览器验收。保持分支历史，由 CTO 合并，不自动推送远程。

调用清单全部从 `src/lib/contracts` 导入：`system.getInfo/openExternal/pickTextFiles`；`collections.list/save`；`documents.list/get/save/setFavorite/remove/restore/import`；`search.query/cancel`；`settings.get/update`；`secrets.set/delete`；`connections.test`；`models.list`；`index.status/rebuild`；`assistant.start`；`operations.subscribe/cancel`。没有新设 IPC channel 或未知 JSON DTO。工作区入口在 `src/app/page.tsx` → `features/workspace/entry.tsx`，客户端选择在 `lib/client/renderer.ts`，流式任务在 `lib/client/use-operation.ts`。

预览：使用工程 Node 22 / npm 10 后 `npm run build`，再 `npm run preview`，进入 `http://127.0.0.1:3100/?demo=1`；未显式 demo 的浏览器入口是选择页。桌面不读取 demo 存储。原型兼容页 `/?legacy=1` 只在无 desktop 且非 Electron 环境可用。旧版迁移通过导入弹窗读取 `zhiyu:notes:v1`；公开契约迁移标题/正文/分类/标签，创建时间与收藏状态以新库 API 为准，原始字段仍保留于旧存储，任何阶段不自动删除。正式桌面以 PostgreSQL 为事实存储，迁移与回滚不得靠清库；回退 UI 提交前先保留数据库和浏览器源数据。

推荐联调用例：空数据库不自动演示 → 保存资料并验证 revision → 后台索引状态 → 中文混合检索的实际 mode/warnings → 打开来源核对行与版本 → 配置模型/key 后流式回答/取消 → 修改维度后显式重建/取消 → 重启后设置和密钥状态 → Windows 原生标题栏实际拖动与离线字体。未配置 provider 时，笔记操作与关键词检索仍应可用。
