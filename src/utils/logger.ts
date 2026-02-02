type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',  // gray
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
}

const RESET = '\x1b[0m'

class Logger {
  private level: LogLevel = 'info'

  setLevel(level: LogLevel): void {
    this.level = level
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level]
  }

  private format(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString().slice(11, 23)
    const color = LEVEL_COLORS[level]
    const levelStr = level.toUpperCase().padEnd(5)

    let formatted = `${color}[${timestamp}] ${levelStr}${RESET} ${message}`

    if (args.length > 0) {
      formatted += ' ' + args.map(a =>
        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
      ).join(' ')
    }

    return formatted
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.format('debug', message, ...args))
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(this.format('info', message, ...args))
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message, ...args))
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message, ...args))
    }
  }

  // Special formatting for agent thoughts
  thought(content: string): void {
    if (this.shouldLog('info')) {
      console.log(`\x1b[35m[THOUGHT] ${content}${RESET}`)
    }
  }

  // Special formatting for tool calls
  tool(name: string, args: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.log(`\x1b[32m[TOOL] ${name}${RESET}`, JSON.stringify(args))
    }
  }

  // Special formatting for results
  result(success: boolean, message: string): void {
    if (this.shouldLog('info')) {
      const status = success ? '[OK]' : '[FAIL]'
      const color = success ? '\x1b[32m' : '\x1b[31m'
      console.log(`${color}${status} ${message}${RESET}`)
    }
  }
}

export const logger = new Logger()
