# Windows 实验交付 · 知屿 0.1.0

2026-10-16，代码基线 `f4978c6`。仅 Windows x64；界面已接通 Fluid/shadcn、Geist/霞鹜文楷、极简毛笔标志、助手 Border Beam、文档/来源检索/助手/设置和 PostgreSQL 服务。

## 产物与打开方式

| 产物        | 工作区路径                        | 用途                                         |
| ----------- | --------------------------------- | -------------------------------------------- |
| NSIS 安装包 | `release/Zhiyu-0.1.0-win-x64.exe` | 125,615,161 字节，可选择安装目录             |
| 目录程序    | `release/win-unpacked/Zhiyu.exe`  | 无需安装即可运行，保留整个 win-unpacked 目录 |

最终目录程序已实际打开，窗口标题为“知屿 · 知识工作区”，使用正常应用配置；等待 5 秒后读取正式 userData 页面，工作区正常显示，未出现“数据库暂不可用”或“索引状态暂不可用”。测试套件使用独立 userData，未覆盖原有笔记或凭据。若尚未连接数据库，界面显示连接提示，可进入“设置与关于”配置。

安装包 SHA-256：

```text
E808FBAEA43BEBB9DF68777D5126301E6DA38991BBC7C2E495D6D26DF305966F
```

安装包从通过测试的目录直接生成。解包核对以下两项与原测试对象完全一致，生成安装包也未改变这两项文件：

| 文件                 | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `Zhiyu.exe`          | `60DDEB2E49286C3D5CC1459143DD607508BDCDC8099BE2D676B89B301584ABBA` |
| `resources/app.asar` | `B48EAD6FBD166D53A01E611198F4B86E09BC10C62509D9D56DF0A2BC431687B1` |

所有包位于 Git 忽略的 release 目录，没有推送或发布到外部。

## 首次配置

1. 独立安装或连接 PostgreSQL >=17，在 public schema 中安装 pgvector >=0.8 和 pg_trgm。权限、扩展和迁移要求见 [数据库说明](../db/README.md)。安装包不内嵌数据库。
2. 在“连接”页填写数据库信息与密码，再执行连接测试。远程连接要求 verify-full。
3. 填写 OpenRouter 和 Cohere API key。聊天模型初始为空，需要在“模型与 API”选择或填写实际可用的 OpenRouter 模型 ID。
4. 按需设置 embedding 1536/3072 维、分块、候选数、权重、重排数、检索片段、温度和上下文预算。索引配置改变后明确开始重建；完成前保留旧索引。

完整搜索链为中文关键词 + OpenRouter `openai/text-embedding-3-large` → 加权 RRF → Cohere `rerank-v3.5`。未配置 key 或向量待建时仍可保存和使用关键词检索，界面显示实际模式与原因。API key 由主进程以 Windows safeStorage 保管；加密不可用时可显式选择仅会话，不落明文。

## 验收结果

顺序 check → 142 项离线测试 → build 全部通过，随后真实数据库 20 项、Edge 浏览器 39 项、真实 Electron 6 项全部通过。最终 Windows 目录 EXE 又实际执行全部 6 项桌面测试，包含 PostgreSQL 保存/搜索/来源行/收藏/回收站/重启、safeStorage、沙盒 IPC、实际拖动、最大化后输入和退出清理。

图标由同一个毛笔 SVG 生成，核对实际 EXE 与窗口原生图标；PE 确认目录程序为 x64。拖动使用 Windows SendInput，原生 DPI=192，物理位移 70×42；渲染缩放 1.25，不等同于所有 Windows 系统缩放均已验证。详细范围、命令与日志见 [验证记录](validation.md)。

本次用下列方式将已验证目录封装为安装包，避免重新构建替换测试对象：

```powershell
. .\scripts\Use-LocalRuntime.ps1
npm run package:dir
# 配置显式的专用 TEST_DATABASE_URL 后执行；不要使用业务库。
npm run test:package:win
node node_modules/electron-builder/out/cli/cli.js --prepackaged release/win-unpacked --win nsis --x64 --publish never --config electron-builder.config.cjs
```

日常从源码直接生成 Windows 安装包也可运行 `npm run package`。生成新包后应重新验证对应的最终目录程序。

## 尚未验证的范围

真实 OpenRouter/Cohere 付费 eval 尚未执行，未提供 provider key。本次 SQL + 合成 HTTP eval 覆盖 24 份资料、30 道中英文问题、过滤和无答案统计，不能据此宣称真实模型质量、路由或计费已验证。live 入口与显式预算配置见 [检索文档](data-retrieval.md)。

开发者姓名、主页、仓库、支持方式和版权尚未提供，界面与 Windows 属性如实显示“未配置”。`npm run release:check` 实际退出 2。程序和安装包均为 NotSigned；本次核对安装包内容，未执行 NSIS 安装/卸载或正式签名发布验收。Mac/Linux 不在此次交付范围。
