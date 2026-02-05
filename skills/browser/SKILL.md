---
name: browser
description: 浏览器操作技能，适用于 Chrome、Firefox、Safari、Edge 等主流浏览器。当操作浏览器应用或进行网页相关任务时激活。
---

# Browser Skill

## 操作规则

- **像人类一样浏览网页** - 你看到的只是屏幕上的一部分内容，更多内容需要滚动才能看到
- **使用 middle_click 打开链接到新标签页**：保持当前页面不变，方便对比和返回
- 地址栏操作：先聚焦地址栏，再输入 URL，最后按 enter
- 搜索操作：点击搜索框 → 输入关键词 → 按 enter → 等待结果加载
- 表单提交：填写完成后按 enter 或点击提交按钮

## 滚动浏览 (CRITICAL)

**You can only see what's visible on screen. Web pages are like long scrolls - you MUST scroll to see more content.**

### Search Results Page
- Search engines typically show 10 results per page
- **First screen may only show 3-5 results** - scroll down to see more
- If you need "top 3 results", make sure you can actually SEE 3 results before clicking
- Scroll the search results page first if needed

### Article/Content Pages
- Articles can be very long - multiple screens worth of content
- **Don't assume you've seen everything after one scroll**
- Keep scrolling until you reach: article footer, comments section, "related articles", or page bottom
- Important information may be in the middle or end of the article

## 操作示例

### 打开新网址
```
1. hotkey: "ctrl l" (Windows/Linux) 或 "cmd l" (macOS) - 聚焦地址栏
2. type: "https://example.com"
3. hotkey: "enter"
4. wait: 1000
```

### 搜索操作
```
1. click: 搜索框位置
2. type: "搜索关键词"
3. hotkey: "enter"
4. wait: 1000
```

### 打开多个搜索结果
```
1. middle_click: 第一个结果链接
2. middle_click: 第二个结果链接
3. middle_click: 第三个结果链接
4. wait: 1000
```

### 截取多个页面内容 (IMPORTANT)
**Process ONE page at a time** - Do NOT batch screenshot operations across multiple tabs.

**Complete workflow for extracting page content:**

```
# Step 1: Open the page
1. click: target tab - switch to the page
2. wait: 1000 - wait for page to fully load

# Step 2: Handle obstructions FIRST
3. Check screenshot for any blocking elements:
   - Cookie consent banners -> click "Accept" or "X"
   - Login popups -> click "X" or press "escape"
   - Ad overlays -> find and click close button
   - Newsletter popups -> press "escape" or close

# Step 3: Scroll and read - A CONTINUOUS PROCESS (NOT just one scroll!)
4. Read the visible content on screen
5. scroll down in page content area
6. wait: 300
7. Read more content
8. scroll down again
9. wait: 300
10. Read more content
11. KEEP SCROLLING AND READING until you see:
    - Article footer / author info
    - Comments section
    - "Related articles" section
    - Page bottom / no more content

**Scrolling is like reading a book - you turn pages CONTINUOUSLY until you finish the chapter, not just once!**

# Step 4: MUST save extracted content with write_file
12. write_file(file_path="workspace/[topic].md", content="...")
   - YOU MUST CALL write_file TOOL - just thinking about content is NOT enough!
   - Include key information, quotes, and facts
   - This file will be your reference for the final summary
   - WITHOUT saving to file, you will FORGET the content when moving to next page!

# Step 5: Close and move to next page
13. hotkey: "cmd w" - close current tab
14. Process next page in the NEXT response (not same response)
```

**[CRITICAL] Scrolling is a CONTINUOUS process, NOT a single action!**
- One scroll only moves the page a little bit - you need MULTIPLE scrolls to read a full article
- Think of it like reading a physical newspaper - you keep scrolling down as you read
- A typical article requires 3-10 scrolls to read completely
- STOP scrolling only when you reach the END of the article (footer, comments, related articles)
- If you only scroll once, you've only seen ~20% of the content!

**[CRITICAL] You MUST call write_file tool to save content!**
- Thinking "I'll remember this" is NOT enough - you WILL forget
- Screenshots are images, not searchable text
- The saved .md file is your ONLY reliable reference for final summary
- If you don't call write_file, the information is LOST

**Why save to file?**
- Screenshots alone are not searchable or quotable
- Saved content can be referenced when writing the final summary
- Ensures you don't lose information when closing tabs

**Why one page at a time?**
- Pages may have ads, login popups, or cookie banners that block content
- You need to see the actual page to handle these obstacles
- Page length varies - you must scroll until reaching the end
- Batching across tabs often results in capturing incomplete content

## 滚动操作注意事项

**CRITICAL: Scroll coordinate must be in the PAGE CONTENT area, NOT the tab bar or toolbar!**

- **Tab bar / Toolbar area** (top of browser window): Scrolling here has NO effect
- **Page content area** (main webpage area, center of screen): Scroll here to navigate page content

Always scroll in the center of the visible webpage content, not near the top of the browser window.

## 处理页面遮挡

Many pages have elements that block content:
- **Cookie consent banners**: Look for "Accept" or "X" button to dismiss
- **Login popups**: Look for "X" close button, or press `escape`
- **Ad overlays**: Look for close button, usually in corner
- **Newsletter popups**: Press `escape` or find close button

Always check the screenshot after loading a page. If content is blocked, handle the obstruction first before scrolling/capturing.

## 技巧

- **批量打开链接**：使用 middle_click 连续打开多个链接，然后逐个处理
- **快速导航**：使用快捷键比点击更快（地址栏、刷新、后退等）
- **等待加载**：页面跳转后务必 wait，等待内容加载完成
- **滚动查看**：长页面需要滚动并多次截图才能获取完整内容
- **标签页管理**：处理完一个标签页后及时关闭，避免混乱

## 注意事项

- 点击链接前确认是否需要在新标签页打开（middle_click vs click）
- 页面加载需要时间，操作后要适当等待
- 弹窗和对话框可能阻挡操作，需要先处理
- 某些网站有反爬机制，操作过快可能触发验证
