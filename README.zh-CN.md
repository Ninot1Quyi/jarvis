# Jarvis

LLM 驱动的 GUI 自动化代理，带有 Overlay UI。

[English](README.md) | [Chinese](README.zh-CN.md)

## Quick Start

**方式一：让 Claude Code 帮你搞定**

如果你已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)，直接运行：

```bash
claude "Read README.md in this project, set up the environment, install dependencies, build and start the project. Fix any errors that occur."
```

**方式二：手动安装**

需要 [Node.js](https://nodejs.org/) (v18+) 和 [Rust](https://rustup.rs/)。

```bash
npm install          # 1. 安装依赖
npm run build        # 2. 编译 TypeScript
npm start            # 3. 启动 Jarvis
```

## Usage

`npm start` 会自动启动 Overlay UI，通过 GUI 输入框输入任务即可。

```bash
npm start              # 启动（默认带 Overlay UI）
npm run start:clear    # 清除持久化消息后启动
```

## Configuration

将 `config/config.example.json` 复制为 `config/config.json`，填入你的 API Key。

## Platform Notes

### Windows

Windows 需要 MSVC 工具链来编译 Overlay UI。

1. **安装 Visual Studio Build Tools**

   下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 或完整版 Visual Studio，勾选 **"Desktop development with C++"** 工作负载。

2. **安装 Rust（MSVC 工具链）**

   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```

> **Note**: Windows 上不要使用 GNU 工具链（`x86_64-pc-windows-gnu`），它的链接器限制会导致 Tauri 等大型项目构建失败。

### macOS

```bash
xcode-select --install
```

### Linux

```bash
# Debian/Ubuntu
sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```
