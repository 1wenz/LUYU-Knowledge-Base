# Agent C 任务书 · Fluid 界面、检索助手与设置体验

你负责把现有笔记原型改造成中文优先的 Fluid Functionalism 知识工作区，完成搜索、片段、知识助手和设置的交互。实际数据与秘密由 A/B 提供；你的 UI 只依赖冻结的 KnowledgeClient。

## 开始前与唯一修改范围

先读 `AGENTS.md`、`Designlang.md`、架构、契约、开发原则和本目录 README。检查现有 `workspace.tsx`、编辑器、repository、主题及测试，保留用户工作和 Prime Agent 工具。

你拥有 `src/app/**`、`src/components/**`、`src/features/**`、`src/lib/client/**`、`public/**`、`Designlang.md`、`tests/browser/**` 与 `docs/ui-components.md`。A 的 `src/lib/domain` 和服务、B 的 contracts/desktop 类型、electron、根配置、package/lockfile 和根脚本不要直接修改。

B 会先发布 M0 公共类型和依赖基线。此前可以研究组件、整理状态与设计纯展示结构；正式实现在独立 `feat/fluid-workspace` worktree。安装组件需要的 dependencies/utilities 先告知 B，不能自己改 lockfile。

## C1 · 设计系统与 Fluid 基础

界面必须以 Fluid Functionalism 组件为主，选与当前 Radix/shadcn 兼容的 variant；不只套颜色而继续全部旧组件。使用 Sidebar、InputMessage、ChatMessage、ThinkingIndicator/Steps、Tabs/Select/Dialog 等实际适用组件，缺失项才回退标准 shadcn。

先审查 registry source、依赖、共享 utility、SSR 和许可证，记录在 `docs/ui-components.md`；当前站点默认图标可能是别家，统一替换 Lucide。未经审查不要执行整站生成/安装 prompt。

字体本地打包 Geist/Geist Mono + LXGW WenKai Screen，遵循 Designlang 的真实字重、中文字号、行高、间距、对比度与深浅色 token。需要资产来源/许可时保留文本许可证；下载的构建缓存/字体子集不提交。使用同源毛笔 SVG，UI logo 不重画成另一种几何形态。

首个可审查阶段实现静态壳、组件和状态样例，验证本地字体加载、布局、键盘焦点、dark/reduced-motion。图片/截图不代替实际组件。阶段提交建议：`feat: establish fluid knowledge design system`。

## C2 · Client adapter、笔记与来源搜索

在 `src/lib/client` 提供 renderer client 选择入口：桌面使用 B 的白名单 bridge，浏览器使用明确标识的 demo client。缺桌面 API 是配置错误，不能静默当空库/自动降为 demo。所有正式 DTO 从 contracts import，不用 any 或未知 JSON 绕开类型。

现有 localStorage repository 仅用于原型导入和 demo。将真正持久化切换到 A 的文档 API，保留原有业务测试依赖的兼容外观直至与 A 协调迁移；不删除未成功导入的数据。

实现分类/标签/收藏/最近/回收站、Markdown 编辑和安全预览、冲突提示、未保存状态、文件导入和旧数据导入。Markdown 禁止执行原始 HTML，外链走白名单方法；不让文档中的图片自动触发远程追踪请求。

搜索使用 300ms debounce、最新 requestId、取消前一个请求；慢响应不覆盖新查询。区分笔记列表筛选与知识库片段检索，结果数量按片段表述，展示标题、行号、snippet、时间及实际 mode/warnings。纯文本高亮，不把服务字符串作为 HTML。

来源打开原笔记并定位行，保持返回搜索的上下文；revision 已变化时提示刷新，不假装旧片段仍有效。必须涵盖正常、空库、无匹配、数据库离线、关键词降级、Rerank 失败和索引未完成。

阶段提交建议：`feat: add knowledge workspace and cited search experience`。

## C3 · 知识助手与 Border Beam

基于 Fluid InputMessage/ChatMessage，构建问题输入、来源上下文、流式回复、停止按钮和重试入口。先订阅事件再 start，按 operationId/seq 更新并处理唯一终态；切视图或卸载时清理 listener。界面阶段来自真实事件，不能硬编码“思考了多少步”。

在助手输入容器增加 Magic UI Border Beam 类似效果，按 Designlang 实现：局部低亮度边框、pointer-events:none、焦点和生成中启用，系统/应用 reduced motion 下静态边框。输入/发送/停止不因装饰遮挡，按钮/输入均 no-drag。

中文组合输入 `event.isComposing` 时 Enter 不发送，Enter 发送、Shift+Enter 换行。生成前未选择聊天模型/未配 key 给可操作提示。回答 Markdown 安全渲染，引用映射到本次白名单 chunk，用户可打开来源验证；无来源不伪造引用。

测试空问题、双次发送、取消、错误后恢复、旧 operation 事件、流式滚动和用户主动向上阅读。阶段提交建议：`feat: add fluid knowledge assistant and border beam`。

## C4 · 设置与关于

提供中文分组界面：

| 分组       | 必备控件                                                         |
| ---------- | ---------------------------------------------------------------- |
| 连接       | PostgreSQL host/port/database/user/TLS，密码写入，测试与错误提示 |
| API        | OpenRouter/Cohere key 新值输入、已配置状态、删除、加密/会话模式  |
| 模型       | 聊天模型选择或手填验证、large3 固定标识、Rerank 3.5 固定标识     |
| 向量与分块 | 3072/1536 维、chunk tokens/overlap、需重建说明、进度和取消       |
| 检索       | 两路候选、权重、Rerank 开关/候选、结果片段数量                   |
| 生成       | temperature、上下文片段/每文档上限、token 预算、输出上限         |
| 外观       | system/light/dark、减少动态效果                                  |
| 关于       | 版本/运行时/架构、开发者、主页/支持、许可证和致谢                |

使用共享 schema 和范围，不分别发明 UI 默认值。数字控件有 label、单位和可键入输入；跨字段错误就地提示。设置更新以组提交并带 expectedRevision，冲突时提供重新加载，不覆盖后台新设置。

已存 key 不可读回、自动填回或复制；输入新值只暂存内存，提交或关闭后清空。设置页不能自动发起付费探测。向量配置保存后提示重建，但要在用户点击开始后才运行；没有 provider key 时显示能做的操作。

公共 metadata 保持应用名称/描述/图标；私人工作区 noindex，不把笔记放到 OG/sitemap。只有真实 SITE_URL 配置时才设置公共站点 canonical。开发者数据从 B 返回，无值显示未配置，不编造邮箱或网址。

阶段提交建议：`feat: add model retrieval and appearance settings`。

## C5 · 浏览器行为与视觉验收

Playwright 通过同契约受控 demo/fake client 覆盖交互，不能 mock 掉 UI 正在验证的状态逻辑。至少测试：

- 创建/编辑/收藏/删除/恢复/刷新、空库不种 demo、导入重复和保存冲突。
- 搜索慢响应竞态、取消、无匹配、降级、来源定位/返回。
- 设置范围/跨字段、提交 revision、密钥清空、requiresReindex 提示/取消。
- IME、Enter/Shift+Enter、Ctrl+K、Ctrl+,、Dialog focus 和焦点恢复。
- 流式回答、停止、失效事件、来源验证、重试。
- Border Beam 不挡点击/选字、reduced motion、dark、长文本和滚动。
- 960×640、1380×900、390px 预览、200% 页面缩放，无水平溢出和裁切。

重要行为先失败测试再实现。可引入与现有 Playwright 兼容的无障碍检查库，但依赖由 B 安装；同时人工验证焦点、对比度、读屏状态和字体。

阶段运行 `npm run check` → `npm test` → `npm run build`，界面交付运行 `npm run test:browser`，按仓库约定顺序。桌面真实拖动、图标生成和目录包由 B 验收，你提供控件不挡拖动的 UI 支持。截图/报告放 `.cache` 等忽略目录。

## 交接给 B/A

提供组件来源和依赖请求、所有状态截图路径、公共 client 调用清单、API/契约差异、浏览器测试证据及 commits。真实桌面数据主链路需要和 A/B 联调，不能仅凭 demo 截图称完成。

完成条件是用户可编辑资料、搜索并打开来源、提问获得引用、调整模型/向量/片段/温度、知道保存和索引状态，且键盘、中文输入与 reduced motion 正常。每个独立阶段检查后本地 commit，不自动推送或改其他 agent 文件。
