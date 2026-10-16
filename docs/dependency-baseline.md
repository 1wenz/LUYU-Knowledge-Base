# 共享依赖基线

2026-10-16，由集成负责人统一锁定 A/C 已提出的依赖；平台流 B 继续维护根配置和后续升级。本阶段不改其他 agent 的活动 worktree。

| 用途 | 锁定版本 |
| --- | --- |
| PostgreSQL | `pg@8.23.1`、`@types/pg@8.23.1` |
| LangChain | `@langchain/core@1.2.18`、`@langchain/openai@1.6.2`、`@langchain/textsplitters@1.0.2` |
| large3 tokenizer | `js-tiktoken@1.0.21` |
| UI 动效 | `motion@14.3.0` |
| Markdown | `react-markdown@10.1.0`、`remark-gfm@4.0.1` |
| 浏览器无障碍测试 | `@axe-core/playwright@4.14.0` |

运行时使用已准备的 Node 22.22.0；不修改系统 Node 或全局代理。npm 锁文件固定传递依赖。Electron 主进程在构建时打包运行时依赖，preload 不加载数据库、LangChain 或 provider SDK。后续接入需检查实际 bundle 的外部 import，不能仅凭安装成功断言打包可用。

默认离线 `npm test` 同时发现 `tests/portability/` 和 `tests/regressions/`；真实数据库、网络 eval 保持显式入口，缺凭据时不计为通过。生命周期回归已从 acceptance 目录移到 regressions，避免默认漏跑。

OpenRouter 的 embedding 固定为 `openai/text-embedding-3-large`；tokenizer 使用 `cl100k_base`。token 计数用于分块上限，不代替 provider 的真实用量统计或支持能力探测。Cohere rerank 继续使用 HTTP `rerank-v3.5`，不为单个 endpoint 增加 SDK。

验证：上述依赖的 `npm ls` 无 peer 冲突；在独立整合 worktree 顺序执行 `npm run check`、`npm test`（81/81）、`npm run build` 均通过。此时 A/C 后续服务与 UI 尚未接入，因此完整 provider bundle 和实际 Markdown/motion 使用还需后续整合测试。
