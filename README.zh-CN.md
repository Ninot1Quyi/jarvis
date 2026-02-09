# Jarvis

LLM 驱动的 GUI 自动化代理。

[English](README.md) | [中文](README.zh-CN.md)

## Quick Start

**方式一（推荐）：让 AI Coding 工具帮你搞定**

在项目目录下打开任意 AI Coding 工具（Claude Code、Cursor、Trae、Codex CLI、Kimi CLI 等），告诉它：

```
Read README.md in this project, set up the environment, install dependencies, build and start the project. Fix any errors that occur.
```

&nbsp;

**方式二：手动安装**

需要 [Node.js](https://nodejs.org/) (v18+) 和 [Rust](https://rustup.rs/)。

```bash
npm install          # 1. 安装依赖
npm run build        # 2. 编译 TypeScript
npm start            # 3. 启动 Jarvis
```

## Usage

启动后通过 GUI 输入框输入任务即可。

## Configuration

将 `config/config.example.json` 复制为 `config/config.json`，填入你的 API Key。

## Platform Notes

### Windows

Windows 需要 MSVC 工具链来编译 Overlay UI。

1. **安装 Visual Studio Build Tools**

   下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（轻量级，不需要安装完整的 Visual Studio IDE），勾选 **"Desktop development with C++"** 工作负载。

2. **安装 Rust（MSVC 工具链）**

   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```

> **Note**: Windows 上不要使用 GNU 工具链（`x86_64-pc-windows-gnu`），它的链接器限制会导致 Tauri 等大型项目构建失败。
