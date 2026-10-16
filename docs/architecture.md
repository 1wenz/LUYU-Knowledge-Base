# 架构与后续计划

## 运行方式

`Next.js` 使用 App Router。开发时 Electron 加载本机 Next.js 服务，生产时读取 `out/` 静态导出目录。生产资源通过 `knowledge://app` 协议加载，使用标准、安全源来支持静态资源和本地存储。

此工程的页面不依赖 Next.js 服务端运行时。未来需要文件系统、SQLite 或系统能力时，由 Electron 主进程承载，通过 preload 接口调用；不要把 Server Actions 或运行时 API 路由直接加入桌面静态导出。

## 职责边界

- `src/features/knowledge/model.ts`：笔记、分类、草稿校验和搜索过滤。
- `repository.ts`：存储接口与初始 localStorage 实现。包含版本校验、损坏数据保护和其他窗口更新订阅。
- `workspace.tsx`、`note-editor.tsx`：知识库浏览与编辑。
- `electron/main.ts`：窗口生命周期、静态资源协议和 IPC 来源校验。
- `electron/preload.ts`：仅暴露读取应用信息的 API；页面无法直接访问 Node。

初始数据结构：`{ version: 1, notes: Note[] }`。浏览器和桌面使用各自的本地存储源，数据不会自动共享；尚无同步、备份、文件导入导出和账户系统。分类目前是固定的三个演示分类，搜索是内存中的文本匹配，正文使用纯文本显示。

Electron 保持上下文隔离、禁用 Node 集成和开启渲染进程沙盒。生产页面添加 CSP；Next.js 的内联启动脚本暂需 `script-src 'unsafe-inline'`，后续打包管线可以用脚本哈希收紧策略。拒绝额外窗口、未知页面导航和权限请求；IPC 验证主窗口、顶层 frame 与地址。

## 后续开发

1. SQLite 持久化与迁移：在主进程增加异步存储服务和经过参数校验的笔记 API。
2. Markdown 编辑和预览、自动保存、可恢复的回收站。
3. 自定义分类与标签管理、Markdown/文件导入、导出和备份。
4. SQLite FTS 全文检索，再按需要增加向量检索和知识问答。
5. 为跨平台分发增加图标、签名、安装包验证和自动更新。

初始化中 Next.js 构建启用了线程 worker，并限制到两个 worker，避免当前 Windows 沙盒阻止 fork；TypeScript 检查仍然执行，没有跳过构建类型错误。
