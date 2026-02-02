import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import type { Tool } from '../../types.js'

// Read Tool - Read file contents
export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: 'Read and display the contents of a file',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed, optional)',
        },
        limit: {
          type: 'number',
          description: 'Number of lines to read (optional)',
        },
      },
      required: ['file_path'],
    },
  },
  async execute(args) {
    try {
      const filePath = args.file_path as string
      const offset = args.offset as number | undefined
      const limit = args.limit as number | undefined

      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File does not exist: ${filePath}` }
      }

      const stats = fs.statSync(filePath)
      if (!stats.isFile()) {
        return { success: false, error: `Path is not a file: ${filePath}` }
      }

      const content = fs.readFileSync(filePath, 'utf8')
      const lines = content.split('\n')

      let displayLines = lines
      let startLine = 1
      let endLine = lines.length

      if (offset !== undefined) {
        startLine = Math.max(1, offset)
        displayLines = lines.slice(startLine - 1)
      }

      if (limit !== undefined) {
        displayLines = displayLines.slice(0, limit)
        endLine = Math.min(startLine + limit - 1, lines.length)
      } else if (offset !== undefined) {
        endLine = lines.length
      }

      const formattedContent = displayLines
        .map((line, index) => {
          const lineNumber = startLine + index
          return `${lineNumber.toString().padStart(5)}→${line}`
        })
        .join('\n')

      return {
        success: true,
        data: {
          file_path: filePath,
          content: formattedContent,
          start_line: startLine,
          end_line: endLine,
          total_lines: lines.length,
        },
      }
    } catch (error) {
      return { success: false, error: `Read failed: ${(error as Error).message}` }
    }
  },
}

// Write Tool - Write content to file
export const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description: 'Write or overwrite content to a file. Creates parent directories if needed.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['file_path', 'content'],
    },
  },
  async execute(args) {
    try {
      const filePath = args.file_path as string
      const content = args.content as string

      const fileExists = fs.existsSync(filePath)
      const dir = path.dirname(filePath)

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(filePath, content, 'utf8')
      const stats = fs.statSync(filePath)
      const action = fileExists ? 'overwritten' : 'created'

      return {
        success: true,
        data: {
          file_path: filePath,
          size: stats.size,
          action,
        },
      }
    } catch (error) {
      return { success: false, error: `Write failed: ${(error as Error).message}` }
    }
  },
}

// Edit Tool - Replace text in file
export const editFileTool: Tool = {
  definition: {
    name: 'edit_file',
    description: 'Edit existing file by replacing old_string with new_string',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace',
        },
        new_string: {
          type: 'string',
          description: 'The new text to replace with',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false)',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  async execute(args) {
    try {
      const filePath = args.file_path as string
      const oldString = args.old_string as string
      const newString = args.new_string as string
      const replaceAll = (args.replace_all as boolean) || false

      if (oldString === newString) {
        return { success: false, error: 'old_string and new_string must be different' }
      }

      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File does not exist: ${filePath}` }
      }

      const content = fs.readFileSync(filePath, 'utf8')

      if (!content.includes(oldString)) {
        return { success: false, error: `String not found in file: "${oldString.slice(0, 50)}..."` }
      }

      const occurrences = content.split(oldString).length - 1
      if (!replaceAll && occurrences > 1) {
        return {
          success: false,
          error: `String appears ${occurrences} times. Use replace_all=true or provide more context`,
        }
      }

      const newContent = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString)

      fs.writeFileSync(filePath, newContent, 'utf8')

      return {
        success: true,
        data: {
          file_path: filePath,
          replacements: replaceAll ? occurrences : 1,
        },
      }
    } catch (error) {
      return { success: false, error: `Edit failed: ${(error as Error).message}` }
    }
  },
}

// Grep Tool - Search file contents using ripgrep
export const grepTool: Tool = {
  definition: {
    name: 'grep',
    description: 'Search for text content within files using regex patterns (requires ripgrep)',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search query or regex pattern',
        },
        path: {
          type: 'string',
          description: 'Directory or file to search in',
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Case insensitive search (default: false)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)',
        },
      },
      required: ['pattern', 'path'],
    },
  },
  async execute(args) {
    try {
      const pattern = args.pattern as string
      const searchPath = args.path as string
      const caseInsensitive = (args.case_insensitive as boolean) || false
      const maxResults = (args.max_results as number) || 50

      if (!fs.existsSync(searchPath)) {
        return { success: false, error: `Path does not exist: ${searchPath}` }
      }

      const rgArgs = [pattern, '-n', '--color=never']
      if (caseInsensitive) rgArgs.push('-i')
      rgArgs.push(searchPath)

      return new Promise((resolve) => {
        const rg = spawn('rg', rgArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

        let stdout = ''
        let stderr = ''

        rg.stdout.on('data', (data) => {
          stdout += data.toString()
        })

        rg.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        rg.on('close', (code) => {
          if (code === 0 || code === 1) {
            const lines = stdout.split('\n').filter((l) => l.trim())
            const truncated = lines.slice(0, maxResults)
            resolve({
              success: true,
              data: {
                pattern,
                path: searchPath,
                matches: lines.length,
                output: truncated.join('\n') || 'No matches found',
              },
            })
          } else {
            resolve({ success: false, error: `ripgrep failed: ${stderr}` })
          }
        })

        rg.on('error', (error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            resolve({ success: false, error: 'ripgrep (rg) is not installed' })
          } else {
            resolve({ success: false, error: error.message })
          }
        })
      })
    } catch (error) {
      return { success: false, error: `Grep failed: ${(error as Error).message}` }
    }
  },
}

// Bash Tool - Execute shell commands
export const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: 'Execute a bash command and return the output',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },
  },
  async execute(args) {
    try {
      const command = args.command as string
      const cwd = (args.cwd as string) || process.cwd()
      const timeout = (args.timeout as number) || 30000

      return new Promise((resolve) => {
        const proc = spawn('bash', ['-c', command], {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout,
        })

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => {
          stdout += data.toString()
        })

        proc.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        proc.on('close', (code) => {
          const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '')
          resolve({
            success: code === 0,
            data: {
              command,
              exit_code: code,
              output: output.slice(0, 10000), // Limit output size
            },
            error: code !== 0 ? `Command exited with code ${code}` : undefined,
          })
        })

        proc.on('error', (error) => {
          resolve({ success: false, error: `Bash failed: ${error.message}` })
        })
      })
    } catch (error) {
      return { success: false, error: `Bash failed: ${(error as Error).message}` }
    }
  },
}

export const fileTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  grepTool,
  bashTool,
]
