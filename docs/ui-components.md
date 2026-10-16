# UI 组件、资产与 Agent C 交接记录

Agent C / agent3；分支 `feat/fluid-workspace`，独立 worktree `D:/Warp/zhiyu-c-ui`。本文只记录已经核实的来源与实施状态，截图或 demo 不代表真实桌面链路已通过验收。

## 当前阶段与集成边界

2026-10-16：完成设计文件、原型和冻结契约阅读。原型使用 localStorage、硬编码分类与同步编辑接口；它不满足 v1 的 PostgreSQL 持久化、软删除、revision、来源检索或助手要求。原型 repository/model 暂留兼容，避免破坏既有业务测试和旧数据。

准备阶段从 `e1ebf13` 建立独立分支，只提交 C 所属的来源记录和获许可资产。正式 UI 与 client 实现在 B 发布完整 M0 后进行，不复制公共 DTO，不修改 package/lockfile、Electron、共享类型或根脚本。所有提交留在此分支，供 CTO 合并。

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

准备阶段：仅字体/许可来源及哈希核对，尚未接入应用，也未宣称字体计算结果、布局、功能或浏览器检查通过。完整 M0 后依次执行 `npm run check` → `npm test` → `npm run build` → `npm run test:browser`。正式 DTO 和设置范围从 B 的共享 contracts/schema 导入；主链路需要 A/B 实现后联调。
