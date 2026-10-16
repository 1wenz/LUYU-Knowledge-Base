export type EvalDocument = { key: string; title: string; content: string; tags: string[] };
export type EvalQuestion = {
  id: string;
  language: "zh" | "en";
  query: string;
  relevant: Record<string, number>;
};

// Entirely fictional policies and products. Never import a user's notes into this fixture.
export const corpus: EvalDocument[] = [
  {
    key: "receipt",
    title: "合成采购报销规则",
    content:
      "星屿实验室采购报销需提供电子发票和订单编号，审批人是项目负责人。报销须在付款后 15 天内提交；截图不能替代发票。",
    tags: ["财务", "合成"],
  },
  {
    key: "backup",
    title: "合成离线备份制度",
    content:
      "星屿知识库每周五生成本地加密备份，保留 8 周。恢复前先校验 SHA-256；备份成功不代表恢复成功，每月实际演练一次。",
    tags: ["运维", "合成"],
  },
  {
    key: "conflict",
    title: "合成同步冲突处理",
    content:
      "当两台离线设备修改同一笔记时，系统保留两份冲突副本，用户手动合并正文。不可简单以客户端最后写入时间覆盖另一份。",
    tags: ["同步", "合成"],
  },
  {
    key: "accessibility",
    title: "合成界面无障碍规范",
    content:
      "键盘操作必须能到达搜索、编辑与保存按钮，焦点需要可见。普通文本对比度至少 4.5:1；遵循系统减少动效设置。",
    tags: ["设计", "合成"],
  },
  {
    key: "vector",
    title: "合成向量索引方案",
    content:
      "实验知识库保存 3072 维 float32 原向量，用 halfvec HNSW 召回 80 个候选，再按原向量余弦距离重排取 40 个。不能直接把 1536 维查询向量用于旧 3072 索引。",
    tags: ["检索", "合成"],
  },
  {
    key: "rrf",
    title: "合成混合检索融合",
    content:
      "关键词与向量分别召回，按片段去重后执行加权 RRF。默认两路各 0.5，排名平滑常数是 60；融合看名次而非直接相加不同量纲的分数。",
    tags: ["检索", "合成"],
  },
  {
    key: "rerank",
    title: "合成重排故障策略",
    content:
      "最多 50 个融合候选送入 Cohere rerank-v3.5。重排服务限流、超时或鉴权失败时保留 RRF 顺序，并返回可解释的降级提示。",
    tags: ["检索", "合成"],
  },
  {
    key: "secret",
    title: "合成桌面凭据边界",
    content:
      "数据库密码和 AI API key 只由 Electron 主进程读取。渲染进程通过最小 preload API 调用业务方法，不应把凭据写进 localStorage、日志或公开 DTO。",
    tags: ["安全", "合成"],
  },
  {
    key: "lease",
    title: "合成索引任务恢复",
    content:
      "向量任务用持久化租约和 SKIP LOCKED 领取。进程退出后，过期租约可重新领取；响应写回必须核对文档 revision，不能覆盖编辑后的新笔记。",
    tags: ["索引", "合成"],
  },
  {
    key: "citation",
    title: "合成助手来源规则",
    content:
      "知识助手每个引用必须指向本次上下文中的片段及其 revision。用户修改或删除来源后，应撤销旧引用并要求重新提问。资料不足时明确说明，不能编造出处。",
    tags: ["助手", "合成"],
  },
  {
    key: "migration",
    title: "Synthetic migration handbook",
    content:
      "Schema migrations run in ordered transactions. Each published SQL file has a SHA-256 checksum. Back up the database before upgrades; reject unknown versions instead of editing migration history or clearing tables.",
    tags: ["database", "合成"],
  },
  {
    key: "incident",
    title: "Synthetic incident response",
    content:
      "For the fictional Northstar service, acknowledge a severity-one incident within 7 minutes, select one incident commander, and publish an internal status update every 20 minutes. Preserve the timeline for the review.",
    tags: ["operations", "合成"],
  },
  {
    key: "refund",
    title: "Synthetic refund policy",
    content:
      "The fictional Lantern subscription allows a full refund within 12 days of the first purchase if no paid export has been used. Renewal payments need a manual review and are not automatically covered.",
    tags: ["billing", "合成"],
  },
  {
    key: "release",
    title: "Synthetic release checklist",
    content:
      "The fictional Windows pilot requires type checks, behavior tests, a production build, and a launch of the packaged x64 application. Drag the native title bar and verify search and editing before marking the release ready.",
    tags: ["release", "合成"],
  },
  {
    key: "retention",
    title: "Synthetic telemetry retention",
    content:
      "The fictional Orchid app stores aggregate diagnostic counters for 21 days. It never uploads note bodies or provider keys. A deletion request removes retained account diagnostics within 48 hours.",
    tags: ["privacy", "合成"],
  },
  {
    key: "garden",
    title: "合成屋顶花园",
    content: "蓝钟社区屋顶花园每周三早晨浇水，雨天暂停。薄荷与迷迭香使用不同花盆。",
    tags: ["生活", "合成"],
  },
  {
    key: "tea",
    title: "合成茶饮配方",
    content: "青灯冷泡茶用 5 克茶叶与 500 毫升冷水，冷藏 6 小时。此配方不包含咖啡豆。",
    tags: ["生活", "合成"],
  },
  {
    key: "train",
    title: "合成城际列车",
    content: "虚构的北湾线周末首班车为 08:20，行程 42 分钟。车票不可用于机场巴士。",
    tags: ["出行", "合成"],
  },
  {
    key: "recipe",
    title: "Synthetic kitchen recipe",
    content:
      "Fictional moonbread uses rye flour, warm water and yeast. Let the dough rest for 45 minutes before baking. This is a recipe, not an operational recovery procedure.",
    tags: ["food", "合成"],
  },
  {
    key: "camera",
    title: "Synthetic camera club",
    content:
      "The fictional Riverlight club meets on the second Saturday each month. Members practice landscape composition and bring their own tripod.",
    tags: ["hobby", "合成"],
  },
  {
    key: "library",
    title: "Synthetic library loan",
    content:
      "The fictional West Pine library lends paper books for 18 days, with one renewal. Rare maps can only be read in the archive room.",
    tags: ["books", "合成"],
  },
  {
    key: "weather",
    title: "合成气象观测",
    content:
      "虚构的白石站每天 09:00 记录气温和风速，仪器每季度校准一次。观测记录不含用户行为数据。",
    tags: ["科学", "合成"],
  },
  {
    key: "music",
    title: "合成乐团排练",
    content: "纸鸢乐团周二晚练习弦乐四重奏，排练室可容纳 12 人。新成员先完成视奏。",
    tags: ["音乐", "合成"],
  },
  {
    key: "cycling",
    title: "Synthetic cycling route",
    content:
      "The fictional Cedar loop is 16 kilometers long and includes two water stops. Helmets are required; the eastern bridge is closed on Mondays.",
    tags: ["sport", "合成"],
  },
];

const pairs: Array<[string, string, string]> = [
  [
    "receipt",
    "采购报销需要什么材料，几天内提交？",
    "What proof and deadline apply when claiming a purchase expense?",
  ],
  [
    "backup",
    "备份保留多久，怎样确认能恢复？",
    "How long are offline snapshots retained, and how is restoration verified?",
  ],
  [
    "conflict",
    "两台设备离线改了同一篇笔记，怎么处理？",
    "What happens if two disconnected devices edit the same note?",
  ],
  [
    "accessibility",
    "键盘焦点和普通文本对比度有什么规定？",
    "Which keyboard focus and text contrast requirements apply to the interface?",
  ],
  [
    "vector",
    "3072 维向量怎么建立 HNSW 并重排？",
    "How many half-precision ANN candidates are rescored using original float vectors?",
  ],
  [
    "rrf",
    "关键词和向量名次如何融合，默认权重多少？",
    "Which reciprocal-rank weights and smoothing constant combine lexical and semantic results?",
  ],
  [
    "rerank",
    "重排服务超时或者限流时用什么顺序？",
    "What ranking survives when Cohere reranking becomes unavailable?",
  ],
  [
    "secret",
    "API key 和数据库密码应该放在哪个进程？",
    "Where may desktop credentials be read, and can they be put in browser storage?",
  ],
  [
    "lease",
    "索引进程退出后如何继续，慢响应怎样避免覆盖新笔记？",
    "How do expired indexing leases resume without overwriting newer note revisions?",
  ],
  [
    "citation",
    "回答来源被修改了还能引用旧版本吗？",
    "What should the assistant do if a cited source changes or evidence is missing?",
  ],
  [
    "migration",
    "已发布 SQL 的校验和变了，迁移应怎么处理？",
    "Why must published SQL checksums and ordered migration history stay immutable?",
  ],
  [
    "incident",
    "一级事故几分钟内确认，多久更新一次状态？",
    "Who coordinates a severity-one incident, and how often is status updated?",
  ],
  [
    "refund",
    "首次购买后几天内可退款，有什么限制？",
    "Can a Lantern customer get a first-purchase refund after using a paid export?",
  ],
  [
    "release",
    "Windows 试验版发布前需要验证哪些行为？",
    "Which build checks and packaged Windows interactions gate the pilot release?",
  ],
  [
    "retention",
    "诊断数据保留几天，删除请求多久执行？",
    "How long does Orchid retain diagnostics, and does it upload note bodies?",
  ],
];
export const questions: EvalQuestion[] = pairs.flatMap(([key, zh, en], index) => [
  {
    id: `q${String(index * 2 + 1).padStart(2, "0")}`,
    language: "zh" as const,
    query: zh,
    relevant: { [key]: 3 },
  },
  {
    id: `q${String(index * 2 + 2).padStart(2, "0")}`,
    language: "en" as const,
    query: en,
    relevant: { [key]: 3 },
  },
]);
