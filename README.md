# Jarvis

LLM-powered GUI automation agent with overlay UI.

## Prerequisites

### All Platforms

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/)

### Windows

Windows requires MSVC toolchain for compiling the overlay UI.

1. **Install Visual Studio Build Tools**

   Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or full Visual Studio, and select **"Desktop development with C++"** workload.

2. **Install Rust with MSVC toolchain**

   ```powershell
   # Install rustup (if not installed)
   winget install Rustlang.Rustup

   # Ensure MSVC toolchain is default
   rustup default stable-x86_64-pc-windows-msvc
   ```

3. **Verify setup**

   ```powershell
   rustup show
   # Should show: stable-x86_64-pc-windows-msvc (default)
   ```

> **Note**: Do NOT use the GNU toolchain (`x86_64-pc-windows-gnu`) on Windows. It has linker limitations that cause build failures with large projects like Tauri.

### macOS

```bash
xcode-select --install
```

### Linux

```bash
# Debian/Ubuntu
sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Quick Start

```bash
npm install
npm run build
npm start
```

First time also run `cd overlay-ui && npm install`.

## Usage

```bash
jarvis                                    # UI + interactive mode
jarvis "打开 Chrome 搜索今天的天气"          # UI + task
jarvis --no-ui "整理桌面上的文件"            # CLI only, no UI
```

### Start Core Only (no UI)

```bash
jarvis --no-ui
```

### Start GUI Only (no agent)

```bash
cd overlay-ui && npm run tauri dev
```

## Examples

```bash
jarvis "打开 Chrome 搜索今天北京的天气"
jarvis "用微信给张三发一条消息说下午开会"
jarvis "打开 PPT 新建一页，画一个项目架构图"
jarvis "搜索 clawdbot，读取前3条结果给我总结"
jarvis "打开备忘录，记录今天的待办事项"
```

## Options

```
--no-ui                CLI only, skip overlay UI
-p, --provider <name>  Provider: anthropic / openai / doubao
-v, --verbose          Debug output
-h, --help             Help
```

## Configuration

`config/key.json` -- API keys, provider settings, mail credentials.
