# Nausicaa 安装记录

安装日期：2026-10-14。

## 安装结果

- 已安装 `nausicaa-harness` 0.2.0，命令为 `nausicaa`。
- 下载来源为 [GitHub 官方发布页](https://github.com/jackispm/nausicaa-harness/releases/tag/v0.2.0)，该版本发布于 2026-09-19（UTC）。
- 使用发布资产 `nausicaa-harness-0.2.0.tgz`，大小 1,627,098 字节。未下载源码压缩包或克隆仓库；安装包包含已编译的 `dist`，无 `package/src/` 目录。
- SHA-256 已核对：`7b36baa437a7ede2bc75594fbc5260be9ee36b8a0899d09e0f7b01e966ea0904`，与 GitHub 发布资产公布值一致。
- 复用现有本地 Node.js 22.22.0 和 npm 10.9.2，满足软件要求的 Node.js >=22.19.0。
- 仅安装运行依赖，安装包、依赖、启动器与运行状态均位于已被 Git 忽略的目录。

## 本地位置

| 用途 | 路径 |
| --- | --- |
| 保留的安装包 | `D:\Warp\demo\.runtime\nausicaa\downloads\nausicaa-harness-0.2.0.tgz` |
| 软件与运行依赖 | `D:\Warp\demo\tools\nausicaa` |
| 启动命令 | `D:\Warp\demo\.runtime\nausicaa\bin\nausicaa.cmd` |
| Node.js 运行时 | `D:\Warp\demo\.runtime\node\node.exe` |

启动器固定使用符合要求的本地 Node.js，并为进程设置 npm 的安装前缀与缓存。启动器目录已加入当前 Windows 用户 PATH。安装路径依赖于本工作区位置；移动目录后须更新 PATH 中对应条目。

## 使用

重新打开终端后运行：

```powershell
nausicaa
```

如果已有终端仍未加载新 PATH，可直接运行：

```powershell
& 'D:\Warp\demo\.runtime\nausicaa\bin\nausicaa.cmd'
```

首次使用在界面中输入 `/login` 登录模型服务，再通过 `/model` 选择模型。退出命令为 `/quit`。

## 校验

- 安装包 SHA-256 校验通过。
- 包内容检查确认项目源码目录未包含在安装包中。
- npm 安装退出码为 0。
- `nausicaa --version` 返回 `0.2.0`，退出码为 0。
- `nausicaa --help` 正常输出，退出码为 0。
- Windows 终端交互界面成功启动，使用独立冒烟状态目录；执行 `/quit` 正常退出，退出码为 0。
- 用户 PATH 中确认包含启动器目录。
- Git 忽略检查确认安装包、软件依赖与本地启动器不纳入版本管理。

尚未登录模型服务，因此未进行需要账户的模型请求。此次工作是安装外部工具，未修改应用程序，不适用项目构建校验。
