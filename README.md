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

## MCP Server Integration

Jarvis supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) as a client, allowing you to connect external MCP servers and use their tools alongside built-in tools.

### Configuration

Add an `mcpServers` section to `config/config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" }
    },
    "remote-server": {
      "url": "https://my-mcp-server.example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

### Transport Modes

| Mode | Config Field | How It Works |
|------|-------------|--------------|
| stdio | `command` + `args` | Jarvis spawns the server as a child process, communicates via stdin/stdout. No manual startup needed. |
| HTTP | `url` | Jarvis connects to an already-running remote server via Streamable HTTP (POST + SSE). |

### Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable to spawn (stdio mode) |
| `args` | string[] | CLI arguments for the command |
| `env` | object | Environment variables passed to the server process |
| `url` | string | Server endpoint URL (HTTP mode) |
| `headers` | object | Custom HTTP headers (e.g., auth tokens) |
| `enabled` | boolean | Set to `false` to skip this server (default: `true`) |

### Tool Naming

MCP tools follow the Claude Code naming convention:

```
mcp__<serverName>__<toolName>
```

For example, a `read_file` tool from a server named `filesystem` becomes `mcp__filesystem__read_file`. This prevents naming collisions with built-in tools.

### Error Handling

- If an MCP server fails to connect, it is skipped and other servers continue normally.
- If a tool call fails at runtime, the agent receives a standard error result and continues.
- MCP failures never crash the agent.

### Testing

```bash
# stdio transport test (auto-starts server)
npx tsx test/mcp.test.ts

# HTTP transport test (requires server running on localhost:3001)
npx @modelcontextprotocol/server-everything streamableHttp
npx tsx test/mcp-http.test.ts
```

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

#### AI Agent Marketplace Index And Agent Router | [API Doc](https://www.deepnlp.org/doc/ai_agent_marketplace)

[![AI Agent Marketplace and Router Badge](https://www.deepnlp.org/api/ai_agent_marketplace/svg?name=Ninot1Quyi/jarvis&badge_type=review)](https://www.deepnlp.org/store/ai-agent/ai-agent/pub-ninot1quyi/jarvis)
    
