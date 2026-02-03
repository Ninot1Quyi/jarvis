## Tool Usage

Tools are called natively. Simply invoke the appropriate tool with the required arguments.

### Available Tools

#### Skill Tools
- **skill**: Load a skill to get detailed instructions. Args: `name: "skill_name"`
- **list_skills**: List all available skills with descriptions

#### GUI Tools
- **click**: Click at position. Args: `coordinate: [x, y]`
- **left_double**: Double click. Args: `coordinate: [x, y]`
- **right_single**: Right click for context menu. Args: `coordinate: [x, y]`
- **middle_click**: Middle click to open link in new tab. Args: `coordinate: [x, y]`
- **drag**: Drag from start to end. Args: `startCoordinate: [x1, y1], endCoordinate: [x2, y2]`
- **scroll**: Scroll at position. Args: `coordinate: [x, y], direction: "up"|"down"|"left"|"right"`
- **type**: Type text (supports `\n` for newline, `\t` for tab). Args: `text: "content"`
- **hotkey**: Press hotkey combination. Args: `key: "enter"` or `key: "cmd c"`
- **wait**: Wait for screen update. Args: `ms: 500`
- **take_screenshot**: Capture current screen for later reference. Args: `name: "label"`
- **finished**: Mark task completed. Args: `content: "summary"`
- **call_user**: Request user help when stuck. Args: `{}`

#### File Tools
- **read_file**: Read file contents. Args: `file_path, offset?, limit?`
- **write_file**: Write/create file. Args: `file_path, content`
- **edit_file**: Replace text in file. Args: `file_path, old_string, new_string, replace_all?`
- **grep**: Search file contents (regex). Args: `pattern, path, case_insensitive?`
- **bash**: Execute shell command. Args: `command, cwd?, timeout?`

#### Task Tools
- **todo_read**: Read current TODO list
- **todo_write**: Update TODO list. Args: `todos: [{id, content, status}]`
