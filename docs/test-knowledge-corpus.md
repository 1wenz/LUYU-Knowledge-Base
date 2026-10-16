# 测试知识语料

2026-10-16 从官方文档整理 8 篇短资料，通过 Electron 的 `documents.import` 导入当前本机知识库。内容是面向测试的中文摘要，保留原始链接，未复制外部文档全文。

| 分类 | 标题 | 来源/用途 |
| --- | --- | --- |
| 技术笔记 | Electron 安全基线：生产桌面应用清单 | [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)，测试安全关键词和精确术语 |
| 技术笔记 | PostgreSQL 全文检索：词法、配置与排序 | [PostgreSQL Chapter 12](https://www.postgresql.org/docs/current/textsearch.html)，测试 FTS、GIN、tsvector |
| 技术笔记 | pgvector：HNSW 与 IVFFlat 的选型和过滤 | [pgvector](https://github.com/pgvector/pgvector)，测试向量索引和过滤语义 |
| 技术笔记 | OpenRouter Embeddings API：输入、维度与失败处理 | [OpenRouter Embeddings API](https://openrouter.ai/docs/api-reference/embeddings)，测试 provider、维度和降级 |
| 技术笔记 | Cohere Rerank 3.5：候选召回后的精排 | [Cohere Rerank](https://docs.cohere.com/docs/rerank-overview)，测试重排和候选来源映射 |
| 产品设计 | WCAG 2.2 可访问性：知识库界面的验收要点 | [W3C WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/)，测试无障碍和界面检索 |
| 产品设计 | 图片知识入库方案：原图、OCR、视觉摘要与质量门禁 | 项目内部设计，测试图片提取失败、校对和证据分层 |
| 灵感碎片 | 混合检索测试集：问题类型与可验证答案 | 项目内部测试规范，测试精确术语、同义表达、过滤和无答案 |

导入报告保存在忽略目录 `.cache/curated-knowledge-import.json`：本次新增 8 篇、跳过 0 篇。当前 OpenRouter/Cohere key 尚未配置时，资料仍可用关键词检索；向量重建和 Rerank 会按应用的降级规则等待 provider 配置，不把“未建向量”误报成资料导入失败。

建议的回归问题：

- “Electron 如何避免渲染进程获得 Node 权限？”
- “HNSW 和 IVFFlat 的主要取舍是什么？”
- “图片 OCR 置信度低时为什么不能直接进入向量索引？”
- “只看产品设计分类，图片入库失败后有哪些恢复路径？”
- “资料中是否说明了 OpenRouter 的实际计费金额？”（期望明确无此证据）
