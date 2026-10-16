# Designlang · 知屿设计标准

版本 1.0，2026-10-16。所有页面、组件、图标和交互实现前必读。本文规定首版标准；效果与可访问性验收由 UI agent 负责，桌面窗口行为由平台 agent 负责。

## 1. 设计方向

知屿是以资料阅读、查找和思考为中心的中文知识库。界面采用纸白、墨色和克制的青绿色；留出阅读空间，让搜索来源和索引状态清晰可见。保留“知屿 / Zhiyu”名称，以极简毛笔作为品牌标记。

主要 UI 来自 [Fluid Functionalism](https://www.fluidfunctionalism.com)，遵循其有功能意义的动效与流畅交互。基础技术为 shadcn/ui、Radix、Tailwind CSS 4，不再叠加另一套完整组件框架。

## 2. UI 库与组件优先级

| 场景             | 首选组件/来源                              | 项目约定                                   |
| ---------------- | ------------------------------------------ | ------------------------------------------ |
| 工作区导航       | Fluid Sidebar、TabsSubtle、CommandMenu     | 当前项突出，hover 不代表已经选中           |
| 助手输入与消息   | Fluid InputMessage、ChatMessage            | 输入固定在消息区下方，来源先于答案展示     |
| 检索和生成状态   | Fluid ThinkingIndicator / ThinkingSteps    | 显示实际阶段，禁止编造“思考过程”或搜索活动 |
| 设置             | Fluid Select、Slider、Switch、Tabs、Dialog | 数值允许直接输入，必须有标签与单位         |
| 表单/按钮/提示   | Fluid 对应组件                             | 沿用 shadcn 语义和 Radix primitives        |
| Fluid 暂缺的组件 | 已有 shadcn/ui 或官方 registry             | 复用相同 token、焦点与圆角                 |
| 图标             | `lucide-react`                             | 用命名导入，不下载另一套图标库             |
| 输入边框动效     | 项目 BorderBeam，参考 Magic UI             | 仅包裹助手输入区域                         |

组件源码进入 `src/components/ui/`，业务组合放 `src/components/` 或 feature 目录。registry 解析器可能生成共享 utility，放入明确的 UI utility 目录并由 C 维护。不要用全量 registry 更新覆盖已有修改；安装前检查依赖、primitive、样式和许可证。所有依赖由 B 统一写入 package/lockfile。

公开站点当前提供 `@fluid` registry，可参考 `npx shadcn@latest registry add @fluid` 的配置方式；具体组件命令以当时官方页面为准，不盲跑整站安装 prompt。现有项目使用 Radix，优先选兼容的 Radix variant。来源记录在实现时新增的 `docs/ui-components.md`。

## 3. 字体

| 内容                    | 字体                                    | 字重                                              |
| ----------------------- | --------------------------------------- | ------------------------------------------------- |
| 拉丁字母、数字、UI 英文 | Geist                                   | 400 正文、500 控件、600 标题                      |
| 中文 UI 与阅读正文      | 霞鹜文楷屏幕阅读版 `LXGW WenKai Screen` | 使用其真实可用字重，默认 400；用尺寸/墨色区分层级 |
| 代码、模型 ID、技术数值 | Geist Mono                              | 400 / 500                                         |

推荐字体栈：

```css
--font-ui: "Geist", "LXGW WenKai Screen", "KaiTi", "STKaiti", serif;
--font-reading: "Geist", "LXGW WenKai Screen", "KaiTi", "STKaiti", serif;
--font-code: "Geist Mono", "Consolas", "LXGW WenKai Screen", monospace;
```

Geist 覆盖英文，中文按缺字回落到文楷；代码的中文也保持可读。避免用 `font-synthesis` 生成没有提供的中文粗体；可将文楷 `@font-face` 限制真实字重并禁止伪粗体。不要将 Geist 字重滑动效果直接套用到单字重中文。

字体须随安装包本地加载；使用 `next/font/local`、包内字体或经许可保存的 WOFF2，不能在运行时访问 Google Fonts/CDN。字体文件是获许可的源资产，OFL 随资产保存，记录版本和来源；应用生成的字体子集/缓存不提交。只预载界面必须使用的文件，验证中文缺字和首屏布局稳定。字体来源：[Geist](https://vercel.com/font)、[霞鹜文楷屏幕阅读版](https://github.com/lxgw/LxgwWenKai-Screen)。

## 4. 字号、行高与密度

CSS 根字号 16px，允许系统缩放；表中数值用 rem 实现。重要中文操作不得低于 14px。窗口在 100% 与 125% Windows 缩放、200% 页面缩放下都要验证。

| 角色           | 字号 | 行高 | 用途                          |
| -------------- | ---: | ---: | ----------------------------- |
| 品牌名称       | 22px | 30px | 侧栏顶部、关于页              |
| 页面标题       | 28px | 38px | 知识库、设置页                |
| 分区标题       | 20px | 30px | 搜索来源、模型设置组          |
| 卡片/结果标题  | 18px | 28px | 笔记标题、来源标题            |
| 正文/输入框    | 16px | 26px | 助手输入、检索片段、普通说明  |
| 阅读正文       | 18px | 32px | Markdown 详情，行宽上限 72ch  |
| 控件/导航/标签 | 15px | 22px | 按钮、侧栏、表单 label        |
| 次要信息       | 14px | 22px | 日期、段落范围、帮助和状态    |
| 代码           | 14px | 22px | 代码块、模型 ID，允许横向滚动 |

按钮高 40px，紧凑工具按钮 36px，主输入最小 44px。图标按钮的有效点击区域至少 36×36px。表单字段垂直间距 16px，组间距 32px；中文描述可以换行，禁止为对齐而固定单行裁掉错误提示。

## 5. 颜色与语义 token

以下是初始色值，最终实现必须实测 WCAG AA：普通正文至少 4.5:1，大字和控件边界按适用规则至少 3:1；不能只凭肉眼称合格。可在保持语义的前提下调整色值并同步本文。

| shadcn token / 语义   | 浅色      | 深色      |
| --------------------- | --------- | --------- |
| background / 纸面     | `#F7F7F2` | `#141918` |
| foreground / 墨色     | `#202925` | `#E6EBE7` |
| card / popover        | `#FFFFFF` | `#1C2421` |
| primary / 强操作      | `#245E50` | `#8BD6B9` |
| primary-foreground    | `#FFFFFF` | `#102B21` |
| secondary / 悬停面    | `#EAF0EA` | `#29362F` |
| muted / 次级底面      | `#EFF1EC` | `#25302A` |
| muted-foreground      | `#526058` | `#ADBEB2` |
| border / 装饰分隔线   | `#CDD6CE` | `#516257` |
| input / 控件边界      | `#7B897E` | `#718679` |
| ring / keyboard focus | `#287A66` | `#8BD6B9` |
| destructive / 失败    | `#AA302C` | `#FFAAA2` |
| success               | `#246247` | `#8ADAB4` |
| warning               | `#82521C` | `#F1CA87` |

保留 Tailwind/shadcn 语义变量而不是在每个组件中硬编码 hex。错误、警告、成功同时带 Lucide 图标和文字，不靠颜色区分。装饰分隔线可更淡，输入/选择边界和 focus ring 必须可辨认。

2026-10-16 C1 对比度核对（WCAG 相对亮度公式）：浅色正文/纸面 13.91:1，次要文字/纸面 6.16:1，次要文字/muted 5.82:1，主按钮文字 7.52:1；深色次要文字/muted 7.03:1，主按钮文字 8.94:1。原 border 在白卡片上 1.49:1、深色卡片上 2.44:1，因此仅作装饰线；input 单独加深后在浅色卡片/纸面上为 3.67:1/3.42:1，在深色卡片/纸面上为 4.07:1/4.56:1。新控件须检查实际相邻底面，不能用上述值代替页面验收。

## 6. 间距、圆角和布局

- 4px 基础网格：4、8、12、16、24、32、48。常规容器内边距 24px，紧凑列表 12–16px。
- 默认控件圆角 10px，卡片/对话框 14px，助手输入容器 16px；tag 可用胶囊。`--radius` 统一管理。
- 阴影轻量，主要靠层次和边界划分；弹出层只设一层阴影，不给每条搜索结果加浮动卡片。
- 桌面初始 1380×900、最小 960×640。侧栏约 224px；中间列表可 320px，详情取剩余宽度；小于 1180px 时用二栏或详情抽屉避免挤压。
- 搜索/助手可以切换为主视图；结果需清楚区分“笔记”和“来源片段”，同一笔记的多段来源显示段落范围。
- 窗口原生标题栏保留。导航、正文、输入区和浮层互不覆盖，滚动容器明确；不能把 `overflow: hidden` 用于掩盖文本被裁切的问题。
- 浏览器预览至少验证 390px；收起侧栏与分栏，用抽屉访问。此项用于保证共享 UI 的适配能力，不扩展为移动端安装包交付。

## 7. 图标与毛笔 logo

品牌源文件：[public/brand/brush.svg](public/brand/brush.svg)。设计采用 64×64 viewBox、右上到左下的笔杆、简短笔箍和收尖笔毫，无背景、无文字、无滤镜，使用 `currentColor`。常用显示尺寸为 24、32、48px；16px favicon 需实际栅格化检查。

UI 浅色使用墨色，深色使用浅墨色；应用图标可将同一轮廓置于纸白底，外留至少图标宽度的 12.5% 空间。禁止改变倾斜角、拉伸比例或另绘一套几何形状。若和邻近“知屿”文字重复说明，图标设置 `aria-hidden`；单独展示时提供“知屿毛笔标志”可访问名称。

Lucide：常用 18/20px，主操作 20px，空状态 32px，默认 strokeWidth 1.75 或 2，同一控件组保持一致。示例语义为 Search、Library、FileText、Settings、Sparkles、Database、RefreshCw、ExternalLink、AlertCircle；以已锁定版本实际导出为准。图标按钮必须有中文 `aria-label`，品牌 logo 独立于 Lucide。

Windows ICO、PNG favicon/OG 和预览图由源 SVG 的构建脚本生成，产物存放忽略目录；UI 用源 SVG。Agent B 负责同源生成，确保 electron-builder 在打包前执行并能找到 `.ico`。

## 8. 动效与 Border Beam

普通 hover/focus 120–180ms、展开/收起 180–240ms；优先采用 Fluid 原有可中断 motion，避免给滚动列表每项加延迟。动画用于标识当前交互和任务状态，不能表达不存在的处理步骤。

助手输入框的 Border Beam 参考 [Magic UI](https://magicui.design/docs/components/border-beam)：

- 装饰层绝对定位在输入外框，边框宽约 1px，8s 一圈，青绿至墨青的低亮度渐变；不添加爆闪或整屏辉光。
- 空闲不循环；聚焦或生成中启用，禁用、错误或 reduced motion 时切换静态边框。
- 装饰层 `aria-hidden=true`、`pointer-events:none`，不改变布局、光标、滚动高度或文字可读性。
- 输入、发送、停止、附件按钮和候选列表均为 `no-drag`。装饰不得拦截点击、文字选中或 IME 组合输入。
- `prefers-reduced-motion: reduce` 与应用设置优先。减少动态效果时保留可见焦点与“检索中/生成中”文本，不以动画作为唯一状态提示。

如果复制 Magic UI 源码，记录来源与许可，校验其 Tailwind/Motion 版本；简单 CSS 能满足时不为该效果单独加动画运行时。Fluid 已需要 Motion 时复用现有依赖。

## 9. 状态、文案与无障碍

界面中文优先。模型 ID、维度、token、URL 保留技术原文，旁边提供简明中文解释。表单先展示用户可以采取的动作，例如“请填写 Cohere API key”或“重新连接数据库”，不得显示数据库堆栈。

每个主要视图包含初次配置、加载、空库、无匹配、正常、降级和错误状态；空库不自动插入示例，demo 模式需明显标识。“向量待完成”和“Rerank 未启用”应可见，但不在日常输入流程堆放内部日志和实现术语。

键盘：Ctrl+K 聚焦搜索，Ctrl+, 打开设置，Escape 关闭弹层；助手 Enter 发送、Shift+Enter 换行，组合输入期间 Enter 不能发送。所有 Dialog 有焦点约束与关闭后焦点恢复，Tooltip 不能代替 label。

检索与回答完成使用轻量 live region；流式文本按节流频率播报，不逐 token 读屏。来源是可聚焦链接/按钮，可用键盘打开和回到原位。选择态、focus、hover 分离，图标不要作为唯一的来源提示。

## 10. UI 验收

1. 检查 Fluid 组件来源、Geist/文楷实际计算字体、全本地加载、无缺字和字体许可证。
2. 验证浅色/深色、960×640 与 1380×900、390px 预览、125% 系统缩放和 200% 页面缩放。
3. 测试创建/编辑/搜索/引用/设置/取消、中文 IME、全部键盘路径和焦点恢复。
4. 校验 Border Beam 不影响点击或选择，reduced motion 下无循环动画。
5. 对关键页面做自动无障碍检查与人工对比度检查；保留截图/报告到忽略目录，记录结果。
6. Windows 原生标题栏实际拖动后窗口位置变化，按钮/输入/浮层正常工作；此项由 B 在真实 Electron 环境验证。
