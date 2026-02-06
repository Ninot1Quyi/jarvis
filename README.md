# Jarvis

LLM-powered GUI automation agent with overlay UI.

## Quick Start

```bash
npm install
npm run build
npm start
```

Overlay UI requires [Rust](https://rustup.rs/). First time also run `cd overlay-ui && npm install`.

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
