import type { Note } from "./model";

export const seedNotes: Note[] = [
  {
    id: "welcome",
    title: "欢迎来到你的知识小岛",
    content:
      "想法常常来得很快，也走得很快。\n\n知屿是一个安静的地方，帮你把零散的想法整理成能够再次使用的知识。\n\n从一条笔记开始\n点击「新建笔记」，记录今天的发现。为笔记选择分类，添上几个标签，下次需要时就能快速找到。\n\n把重要内容留在身边\n点击星标收藏笔记，或使用搜索查找标题、正文和标签。这里的修改会保存在当前设备，刷新后依然可用。",
    collectionId: "ideas",
    tags: ["开始使用", "知识管理"],
    favorite: true,
    createdAt: "2026-10-14T08:00:00.000Z",
    updatedAt: "2026-10-14T08:00:00.000Z",
  },
  {
    id: "design",
    title: "好用的知识库，从减少摩擦开始",
    content:
      "记录应该足够轻，整理应该足够自然。\n\n设计原则\n1. 尽量缩短从想法到记录的路径。\n2. 使用分类建立结构，用标签表达关联。\n3. 让搜索成为可靠的第二入口。\n4. 让内容保持可读，把注意力还给思考。\n\n值得追问的问题\n用户回来寻找一条笔记时，最先记得的是标题、场景，还是某个关键词？",
    collectionId: "product",
    tags: ["产品思考", "体验设计"],
    favorite: true,
    createdAt: "2026-10-13T07:00:00.000Z",
    updatedAt: "2026-10-13T09:30:00.000Z",
  },
  {
    id: "architecture",
    title: "桌面知识库的架构草图",
    content:
      "界面、业务模型和持久化应该有清晰的边界。\n\nNext.js 负责页面和交互，shadcn/ui 提供可维护的基础组件。Electron 主进程负责桌面能力，通过 preload 提供小而明确的接口。\n\n初始化阶段先验证记录、查找、编辑和收藏的完整流程。下一阶段将把存储接入 SQLite，并加入全文检索。",
    collectionId: "engineering",
    tags: ["架构", "Electron"],
    favorite: false,
    createdAt: "2026-10-12T08:00:00.000Z",
    updatedAt: "2026-10-12T08:00:00.000Z",
  },
  {
    id: "reading",
    title: "读完之后，留下自己的理解",
    content:
      "摘录能留下原文，但理解需要自己的表达。\n\n阅读笔记的三个问题\n这段内容解决了什么问题？\n它和我已有的知识有什么联系？\n我会在什么场景下使用它？\n\n尝试在每次阅读之后，用三句话写下自己的答案。",
    collectionId: "ideas",
    tags: ["阅读", "知识管理"],
    favorite: false,
    createdAt: "2026-10-11T08:00:00.000Z",
    updatedAt: "2026-10-11T08:00:00.000Z",
  },
  {
    id: "components",
    title: "建立一致的组件语言",
    content:
      "基础组件的职责，是让交互方式保持一致。\n\n按钮表达动作，输入框收集信息，对话框承载集中任务。颜色、间距、状态反馈共同构成界面的节奏。\n\n组件复用应该服务于清晰的体验，而不是成为新的抽象负担。",
    collectionId: "product",
    tags: ["体验设计", "组件"],
    favorite: false,
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
  },
  {
    id: "local",
    title: "为什么从本地优先开始",
    content:
      "记录知识时，可靠的体验应该是默认选项。\n\n让数据留在设备，让编辑即刻得到反馈，再逐步添加备份、迁移与同步能力。\n\n目前的数据保存在应用本地存储中。后续规划：SQLite 持久化、文件导入与导出、全文检索。",
    collectionId: "engineering",
    tags: ["架构", "本地优先"],
    favorite: false,
    createdAt: "2026-10-09T08:00:00.000Z",
    updatedAt: "2026-10-09T08:00:00.000Z",
  },
];
