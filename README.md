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
-v, --verbose          # Show debug output
```

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

