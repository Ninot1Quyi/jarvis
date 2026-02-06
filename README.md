# Jarvis

GUI automation agent powered by LLM. Unified entry point: starts the overlay UI and agent in one command.

## Quick Start

```bash
# Install dependencies
npm install
cd overlay-ui && npm install && cd ..

# Overlay UI requires Rust
# https://rustup.rs

# Build and run (interactive mode with overlay UI)
npm run build && npm start

# Run with a task
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
-i, --interactive      # Interactive mode (default when no task given)
--no-ui                # CLI only, skip overlay UI
-p, --provider <name>  # Use specific provider (anthropic/openai/doubao)
--anthropic            # Use Anthropic Claude
--openai               # Use OpenAI
--doubao               # Use Doubao
-v, --verbose          # Show debug output
-h, --help             # Show help
```

## Startup Flow

`npm start` does the following automatically:

1. Probes port 19823 -- if the overlay UI is already running, connects directly
2. Otherwise cleans stale processes, spawns `tauri dev` in `overlay-ui/`, waits for the WebSocket server
3. Enables overlay communication and starts the agent
4. On exit (Ctrl+C), kills the entire UI process tree

Use `--no-ui` to skip the overlay and run as a pure CLI agent.

## Message Sources

In interactive mode the agent accepts messages from multiple channels:

- **Terminal** -- type directly in the console
- **Overlay UI** -- send via the floating window
- **Email** -- configure IMAP/SMTP in `config/key.json`, incoming mail is queued automatically

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

## Development

```bash
npm run dev   # tsc --watch
npm start     # starts UI + agent
```

## Configuration

Edit `config/key.json` to set API keys, provider settings, and mail credentials.

Traces are saved to `data/traces/`.

