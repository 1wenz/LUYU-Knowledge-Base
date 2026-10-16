# Agent A · 数据与检索交付

工作分支：`feat/data-retrieval`。工作区：`D:\Warp\zhiyu-a-data`。由 CTO/Agent B 选择阶段提交合并；不自动合并或推送。

## 当前交付

这是 M0 前可独立验证的领域准备阶段，不代表 PostgreSQL 持久化、完整检索服务或知识助手已接通。原型与共享 contracts/schema 由 B 提交，A 不重建缺失工程，也不复制公共 DTO。

- 标题、标签、UTF-8 正文大小与 revision 冲突规则。
- 写入/查询共用 `Intl.Segmenter('zh')`、NFKC 与英文小写规范，字面 ILIKE 参数转义和 1–2 字短词计划。
- Markdown 段落/标题/围栏优先的分块核心，接受模型 tokenizer 的计数端口，保留原文范围、行号和受 token 限制的 overlap；超长代码块可以切分。
- 加权 RRF、chunk 去重、稳定排序，以及 embedding/Rerank 响应映射与数值校验。
- 本次上下文引用白名单和上下文总 token/每文档片段上限。

分词仅用于中文 FTS，不能替代模型 tokenizer。当前测试注入可控计数器来验证算法；真实 large3 tokenizer 的中英文 token 验证要在 B 锁定依赖后补齐。ICU 的词边界可能随运行时版本变化，升级运行时后应重新评估 normalizer/index profile。

## 验证

当前 worktree 尚无 `package.json`、正式测试发现或 M0 依赖基线，不能声称 `npm run check` / `npm test` / `npm run build` 通过。临时只读使用原工作区已有 TypeScript 编译器与 Node 22.22.0，测试输出写入本工作区忽略目录 `.cache/domain-test`，不共用 `.next` 或 Git index：

```powershell
& 'D:\Warp\demo\.runtime\node\node.exe' 'D:\Warp\demo\node_modules\typescript\bin\tsc' --target ES2022 --module commonjs --moduleResolution node --strict --esModuleInterop --skipLibCheck --types node --typeRoots 'D:\Warp\demo\node_modules\@types' --outDir .cache/domain-test tests/domain/data-retrieval-domain.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& 'D:\Warp\demo\.runtime\node\node.exe' --test .cache/domain-test/tests/domain/data-retrieval-domain.test.js
```

已实际执行：TypeScript 严格编译通过，领域行为测试 11/11 通过。最初失败已复现，分块 overlap 的推进与限额问题已修复。数据库集成、provider 网络、浏览器、Electron 和完整构建尚未执行。

## 给 B 的依赖与接口接入需求

B 统一锁定并发布 `pg` / `@types/pg`、`@langchain/core`、`@langchain/openai`、`@langchain/textsplitters` 与 large3 兼容 tokenizer（建议 `js-tiktoken`，验证 `cl100k_base`）。要求兼容 Node >=22.12，LangChain 可由 esbuild 打进 CJS 主进程；不要让 sandbox preload 依赖这些包。

测试发现须包含 `tests/domain/**/*.test.ts`、`tests/search/**/*.test.ts`，并为数据库和付费 eval 提供独立入口；普通 `npm test` 不联网。A 的后续服务会导出 `electron/services/knowledge/index.ts:createKnowledgeService(deps)`，接收 B 注入的设置快照、secret accessor、signal、operationId、事件与脱敏日志。

正式应用服务与 CRUD 要在 M0 的公共类型到达后接入。下一阶段准备版本 SQL、checksum 迁移执行器和独立测试 schema；真实数据库验证要求 PostgreSQL 17、pgvector >=0.8、pg_trgm。未提供数据库连接和 provider key，当前没有检索质量或 live eval 结论。
