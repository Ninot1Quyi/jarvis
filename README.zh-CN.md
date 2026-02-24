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

启动后通过 GUI 输入框输入任务即可。例如：

- `打开 Chrome 搜索 Minecraft`
- `用微信给张三发一条消息说下午三点开会`
- `打开备忘录，记录今天的待办事项`

## Configuration

将 `config/config.example.json` 复制为 `config/config.json`，填入你的 API Key。

## MCP Server 集成

Jarvis 支持 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 客户端，可以连接外部 MCP Server，将其工具与内置工具一起使用。

### 配置方式

在 `config/config.json` 中添加 `mcpServers` 字段：

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

### 传输模式

| 模式 | 配置字段 | 工作方式 |
|------|---------|---------|
| stdio | `command` + `args` | Jarvis 自动启动 server 子进程，通过 stdin/stdout 通信，无需手动启动 |
| HTTP | `url` | Jarvis 连接已运行的远程 server，通过 Streamable HTTP (POST + SSE) 通信 |

### 配置字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `command` | string | 要启动的可执行文件（stdio 模式） |
| `args` | string[] | 命令行参数 |
| `env` | object | 传递给 server 进程的环境变量 |
| `url` | string | Server 端点 URL（HTTP 模式） |
| `headers` | object | 自定义 HTTP 请求头（如认证 token） |
| `enabled` | boolean | 设为 `false` 可跳过该 server（默认 `true`） |

### 工具命名

MCP 工具遵循 Claude Code 命名规范：

```
mcp__<serverName>__<toolName>
```

例如，名为 `filesystem` 的 server 提供的 `read_file` 工具会注册为 `mcp__filesystem__read_file`，避免与内置工具冲突。

### 错误处理

- MCP server 连接失败时自动跳过，不影响其他 server 和内置工具。
- 工具调用失败时，Agent 收到标准错误结果并继续运行。
- MCP 故障不会导致 Agent 崩溃。

### 测试

```bash
# stdio 传输测试（自动启动 server）
npx tsx test/mcp.test.ts

# HTTP 传输测试（需要先启动 server）
npx @modelcontextprotocol/server-everything streamableHttp
npx tsx test/mcp-http.test.ts
```

## Platform Notes

### Windows

Windows 需要 MSVC 工具链来编译 GUI。

1. **安装 Visual Studio Build Tools**

   下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（轻量级，不需要安装完整的 Visual Studio IDE），勾选 **"Desktop development with C++"** 工作负载。

2. **安装 Rust（MSVC 工具链）**

   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```

> **Note**: Windows 上不要使用 GNU 工具链（`x86_64-pc-windows-gnu`），它的链接器限制会导致 Tauri 等大型项目构建失败。
