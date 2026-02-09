# Jarvis

LLM-powered GUI automation agent with overlay UI.

[English](README.md) | [中文](README.zh-CN.md)

## Quick Start

**Option 1: Let AI Coding tools do it for you**

Open any AI coding tool (Claude Code, Cursor, Trae, Codex CLI, Kimi CLI, etc.) in this project directory, and tell it:

```
Read README.md in this project, set up the environment, install dependencies, build and start the project. Fix any errors that occur.
```

**Option 2: Manual setup**

Requires [Node.js](https://nodejs.org/) (v18+) and [Rust](https://rustup.rs/).

```bash
npm install          # 1. Install dependencies
npm run build        # 2. Compile TypeScript
npm start            # 3. Start Jarvis
```

## Usage

`npm start` launches the overlay UI automatically. Enter tasks through the GUI input box.

```bash
npm start              # Start with overlay UI (default)
npm run start:clear    # Clear persisted messages, then start
```

## Configuration

Copy `config/config.example.json` to `config/config.json` and fill in your API keys.

## Platform Notes

### Windows

Windows requires MSVC toolchain for compiling the overlay UI.

1. **Install Visual Studio Build Tools**

   Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or full Visual Studio, and select **"Desktop development with C++"** workload.

2. **Install Rust with MSVC toolchain**

   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
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
