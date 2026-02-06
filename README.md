# Jarvis

GUI automation agent powered by LLM.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
npm start -- "打开 Chrome 搜索今天的天气"
```

## Examples

```bash
# Search and summarize web content
npm start -- "搜索clawdbot，读取前3条结果详细页面给我总结一下都说了什么" -v

# Chat automation with exit condition
npm start -- "用微信问xxx聊天，直到他说"拜拜"才停止" -v

# Creative tasks with presentation software
npm start -- "用ppt给我画个房子，添加新的页面，合理排版，介绍一下自己" -v
```

## Options

```bash
-p, --provider <name>  # Use specific provider (anthropic/openai/doubao)
--anthropic            # Use Anthropic Claude
--openai               # Use OpenAI
--doubao               # Use Doubao
-o, --overlay          # Enable overlay UI (real-time message display)
-v, --verbose          # Show debug output
```

## Overlay UI

Real-time floating window that displays agent messages during execution.

### Features

- Transparent, always-on-top window in bottom-right corner
- Displays all message types: user, assistant, tool, system, error
- Draggable titlebar, minimize/close buttons
- WebSocket communication (decoupled architecture)

### Build Overlay UI

#### macOS

```bash
# Prerequisites: Xcode Command Line Tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Build overlay UI
cd overlay-ui
npm install
npm run tauri build

# Binary location
# ./overlay-ui/src-tauri/target/release/bundle/macos/Jarvis.app
```

#### Windows

```powershell
# Prerequisites: Visual Studio Build Tools with C++ workload
# Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/

# Install Rust
# Download and run: https://win.rustup.rs/

# Build overlay UI
cd overlay-ui
npm install
npm run tauri build

# Binary location
# .\overlay-ui\src-tauri\target\release\bundle\msi\Jarvis_*.msi
```

### Usage

**Terminal 1: Start Overlay UI**

```bash
# macOS - run the built app
open ./overlay-ui/src-tauri/target/release/bundle/macos/Jarvis.app

# Or development mode
cd overlay-ui && npm run tauri dev
```

```powershell
# Windows - run the built app
.\overlay-ui\src-tauri\target\release\Jarvis.exe

# Or development mode
cd overlay-ui; npm run tauri dev
```

**Terminal 2: Run Agent with Overlay**

```bash
npm start -- "your task here" -o

# Example
npm start -- "open Chrome and search for weather" -o -v
```

The overlay UI listens on `ws://127.0.0.1:19823`. The agent connects when `-o` flag is used.

## Skills System

Jarvis supports the [Agent Skills](https://agentskills.io) open standard. Skills extend what the agent can do by providing domain-specific knowledge and instructions.

### Skill Locations

| Location | Path | Scope |
|----------|------|-------|
| Project | `./skills/<skill-name>/SKILL.md` | This project only |
| Project (Claude) | `./.claude/skills/<skill-name>/SKILL.md` | This project only |
| User | `~/.claude/skills/<skill-name>/SKILL.md` | All projects |
| User (Jarvis) | `~/.jarvis/skills/<skill-name>/SKILL.md` | All projects |

### Built-in Skills

- `platform-macos` - macOS platform rules and hotkeys
- `platform-windows` - Windows platform rules and hotkeys
- `platform-linux` - Linux platform rules and hotkeys
- `browser` - Browser operation patterns
- `search` - Web search strategies

### Creating Custom Skills

Create a directory with a `SKILL.md` file:

```
skills/my-skill/
└── SKILL.md
```

SKILL.md format:

```yaml
---
name: my-skill
description: What this skill does and when to use it.
---

# My Skill Instructions

Your instructions here...
```

### Using Community Skills

You can use any skill from the [Anthropic Skills Repository](https://github.com/anthropics/skills):

```bash
# Clone a skill to your project
cp -r /path/to/anthropic-skills/skills/pdf ./skills/
```

## Development

```bash
npm run dev
```

