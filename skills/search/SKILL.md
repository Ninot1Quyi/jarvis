---
name: search
description: 搜索任务技能，适用于各类搜索场景（网页搜索、应用内搜索、文件搜索等）。当任务涉及搜索、查找、查询操作时激活。
---

# Search Skill

## 操作规则

- 搜索操作的标准流程：定位搜索框 → 清空已有内容 → 输入关键词 → 提交搜索 → 等待结果
- 如果搜索框已有内容，先全选清空再输入
- 搜索提交后必须等待结果加载

## 操作示例

### 标准搜索流程
```
1. click: 搜索框位置
2. hotkey: "ctrl a" (全选已有内容)
3. type: "新的搜索关键词"
4. hotkey: "enter"
5. wait: 1000
```

### Spotlight 搜索 (macOS)
```
1. hotkey: "cmd space"
2. wait: 300
3. type: "应用名或文件名"
4. wait: 500
5. hotkey: "enter" (打开第一个结果)
```

### Windows 搜索
```
1. hotkey: "win"
2. wait: 300
3. type: "应用名或文件名"
4. wait: 500
5. hotkey: "enter"
```

### 浏览器内搜索 (Ctrl+F)
```
1. hotkey: "ctrl f" (或 "cmd f")
2. type: "要查找的文本"
3. hotkey: "enter" (跳转到下一个匹配)
```

## 技巧

- 使用精确关键词可以获得更好的搜索结果
- 搜索引擎支持引号精确匹配："exact phrase"
- 使用减号排除词：搜索词 -排除词
- 网站内搜索：site:example.com 关键词
- 文件类型搜索：filetype:pdf 关键词
