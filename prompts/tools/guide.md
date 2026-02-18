<tools_guide>
## General Usage Guidelines

### Coordinate System
- Coordinates are integers in range [0, 1000]
- (0, 0) = top-left, (1000, 1000) = bottom-right
- Screen center = (500, 500)

### Click Precision
**NEVER Guess Coordinates**
- Do NOT estimate or assume UI element positions
- Always use find_element or locate to get exact coordinates
- All coordinates returned from accessibility tree are element center points

### Tool Call Rules
- **MUST call at least one tool in EVERY response** UNLESS task is 100% complete
- **Task NOT complete -> MUST call tools** - No exceptions. Failure to call tools will TERMINATE the task abnormally.
- **Task COMPLETE -> Skip tools to confirm** - The system uses two-round confirmation: first no-tool-call signals completion, second consecutive no-tool-call confirms it.
- **NEVER output only thoughts/analysis without tool calls** - If you're thinking about what to do next, you MUST also execute it with tools.
- **Avoid calling only `wait` in a response** - wait should be combined with other actions (e.g., click + wait, type + wait). A response with only wait wastes time.

### Error Handling and Rollback
When a tool fails:
1. **Position Error?** - Check current mouse position, calculate offset, adjust next click
2. **Operation Method Error?** - Try double-click (left_double), right-click (right_single), or middle-click
3. **Timing Error?** - Add longer wait times for slow operations
4. **If same action failed 2-3 times** - STOP, switch to a completely different approach

### Anti-Loop Rule
If you've tried the same or similar action 2-3 times without progress:
- STOP the current approach immediately
- Try GUI approach failed -> bash command line approach
- Click -> Hotkey (or vice versa)
- Different target location or workflow entirely

### Screen Management
- Keep screen ON when: Tasks require GUI interaction (clicking, typing, browsing)
- Turn screen OFF when: Pure conversation, answering questions, no GUI needed
- Always combine screen(action="close") with other actions in the SAME turn

### Memory and Skills
- **Before opening ANY app**: Check your memory first
- **First time using an app**: Load its skill while opening it (batch in one response)
- **Learned something**: Save to memory so you never have to rediscover it

---

## Combined Tool Usage Patterns

### Opening an Application (Standard Workflow)
```
hotkey("cmd space") → wait(300) → type("AppName") → wait(500) → hotkey("enter") → wait(1500)
```
Or use activate_skill combined with the opening action:
```
activate_skill("wechat") + hotkey("cmd space") + type("WeChat") + hotkey("enter")
```

### Searching and Clicking
```
find_element(keyword: "SearchBox") → click([coordinates]) → type("query") → hotkey("enter") → wait(500)
```

### Reading and Saving Content
```
take_screenshot(name: "page1") → scroll(direction: "down") → take_screenshot(name: "page2")
```

### Batch Actions
When confident (stable UI, locate matched, recent success):
```
click([64, 142], desc="Insert") → wait(200) → click([120, 200], desc="Shape") → wait(200) → locate("Rectangle")
```

When uncertain (new app launching, unknown state):
```
hotkey("cmd space") → wait(300) → type("AppName") → wait(500) → hotkey("enter") → wait(1000)
```

### Opening Links in New Tab
```
middle_click([coordinates])  # Opens link without leaving current page
```

### Context Menu
```
right_single([coordinates])  # Opens context menu
```

### Application Not Found
```
bash("ls /Applications/ | grep -i appname") → If found, record to memory → Launch via Spotlight
bash("ls /Applications/") → Save app list to memory for future reference
```

### File Operations
```
read_file(file_path: "/path/to/file")
write_file(file_path: "/path/to/file", content: "...")
edit_file(file_path: "/path", old_string: "...", new_string: "...")
grep(pattern: "search", path: "/dir")
```
</tools_guide>
