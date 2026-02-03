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

## Development

```bash
npm run dev
```
