# Jarvis

LLM-powered GUI automation agent.

[English](README.md) | [中文](README.zh-CN.md)

## Quick Start

**Option 1 (Recommended): Let AI Coding tools do it for you**

Open any AI coding tool (Claude Code, Cursor, Trae, Codex CLI, Kimi CLI, etc.) in this project directory, and tell it:

```
Read README.md in this project, set up the environment, install dependencies, build and start the project. Fix any errors that occur.
```

&nbsp;

**Option 2: Manual setup**

Requires [Node.js](https://nodejs.org/) (v18+) and [Rust](https://rustup.rs/).

```bash
npm install          # 1. Install dependencies
npm run build        # 2. Compile TypeScript
npm start            # 3. Start Jarvis
```

## Usage

Enter tasks through the GUI input box after starting. For example:

- `Open Chrome and search for Minecraft`
- `Send a message to John on WeChat saying the meeting is at 3pm`
- `Open Notepad and write down today's to-do list`

## Configuration

Copy `config/config.example.json` to `config/config.json` and fill in your API keys.

## Platform Notes

### Windows

Windows requires MSVC toolchain for compiling the GUI.

1. **Install Visual Studio Build Tools**

   Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (lightweight, no need for the full Visual Studio IDE) and select **"Desktop development with C++"** workload.

2. **Install Rust with MSVC toolchain**

   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```

> **Note**: Do NOT use the GNU toolchain (`x86_64-pc-windows-gnu`) on Windows. It has linker limitations that cause build failures with large projects like Tauri.
