import * as fs from 'fs'
import * as path from 'path'
import type { Tool } from '../../types.js'
import { config } from '../../utils/config.js'

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

function getTodoFilePath(): string {
  return path.join(config.dataDir, 'TODOLIST.md')
}

function generateMarkdown(todos: TodoItem[]): string {
  let content = '# TODO LIST\n\n'

  const pending = todos.filter((t) => t.status === 'pending')
  const inProgress = todos.filter((t) => t.status === 'in_progress')
  const completed = todos.filter((t) => t.status === 'completed')

  if (inProgress.length > 0) {
    content += '## In Progress\n'
    inProgress.forEach((todo) => {
      content += `- [x] **${todo.content}** (ID: ${todo.id})\n`
    })
    content += '\n'
  }

  if (pending.length > 0) {
    content += '## Pending\n'
    pending.forEach((todo) => {
      content += `- [ ] ${todo.content} (ID: ${todo.id})\n`
    })
    content += '\n'
  }

  if (completed.length > 0) {
    content += '## Completed\n'
    completed.forEach((todo) => {
      content += `- [x] ~~${todo.content}~~ (ID: ${todo.id})\n`
    })
    content += '\n'
  }

  content += `\n---\n*Last updated: ${new Date().toISOString()}*\n`
  return content
}

function generateSummary(todos: TodoItem[]): string {
  const pending = todos.filter((t) => t.status === 'pending').length
  const inProgress = todos.filter((t) => t.status === 'in_progress').length
  const completed = todos.filter((t) => t.status === 'completed').length
  return `${pending} pending, ${inProgress} in progress, ${completed} completed`
}

// TodoWrite Tool - Create or update TODO list
export const todoWriteTool: Tool = {
  definition: {
    name: 'todo_write',
    description: 'Create or update TODO list for task planning and tracking progress',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Array of todo items with content, status, and id',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the todo item' },
              content: { type: 'string', description: 'Todo item description' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Current status of the todo item',
              },
            },
            required: ['id', 'content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
  async execute(args) {
    try {
      const todos = args.todos as TodoItem[]

      if (!Array.isArray(todos)) {
        return { success: false, error: 'todos parameter must be an array' }
      }

      // Validate each todo item
      for (const todo of todos) {
        if (!todo.content || !todo.status || !todo.id) {
          return { success: false, error: 'Each todo must have content, status, and id' }
        }
        if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
          return { success: false, error: `Invalid status: ${todo.status}` }
        }
      }

      // Check for multiple in_progress tasks
      const inProgressTasks = todos.filter((t) => t.status === 'in_progress')
      if (inProgressTasks.length > 1) {
        return { success: false, error: 'Only one task can be in_progress at a time' }
      }

      // Generate markdown content
      const markdownContent = generateMarkdown(todos)
      const todoFilePath = getTodoFilePath()

      // Ensure directory exists
      const dir = path.dirname(todoFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Write to file
      fs.writeFileSync(todoFilePath, markdownContent, 'utf8')

      return {
        success: true,
        data: {
          file_path: todoFilePath,
          summary: generateSummary(todos),
        },
      }
    } catch (error) {
      return { success: false, error: `TodoWrite failed: ${(error as Error).message}` }
    }
  },
}

// TodoRead Tool - Read current TODO list
export const todoReadTool: Tool = {
  definition: {
    name: 'todo_read',
    description: 'Read the current TODO list',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  async execute() {
    try {
      const todoFilePath = getTodoFilePath()

      if (!fs.existsSync(todoFilePath)) {
        return {
          success: true,
          data: {
            file_path: todoFilePath,
            content: 'No TODO list exists yet.',
          },
        }
      }

      const content = fs.readFileSync(todoFilePath, 'utf8')

      return {
        success: true,
        data: {
          file_path: todoFilePath,
          content,
        },
      }
    } catch (error) {
      return { success: false, error: `TodoRead failed: ${(error as Error).message}` }
    }
  },
}

export const todoTools: Tool[] = [todoWriteTool, todoReadTool]
