import type { Tool } from '../../types.js'
import { logger } from '../../utils/logger.js'

// 坐标归一化因子
const COORDINATE_FACTOR = 1000

// 归一化坐标 [0, 1000] -> [0, 1]
function normalizeCoord(value: number): number {
  return value / COORDINATE_FACTOR
}

// ============ Mouse Tools ============
// 工具定义使用 [0, 1000] 坐标范围
// 执行时自动归一化为 [0, 1]，再乘以屏幕尺寸

export const clickTool: Tool = {
  definition: {
    name: 'click',
    description: 'Click at the specified position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]. (0,0)=top-left, (1000,1000)=bottom-right',
        },
      },
      required: ['coordinate'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const normalizedX = normalizeCoord(coord[0])
    const normalizedY = normalizeCoord(coord[1])

    const x = Math.round(normalizedX * screenWidth)
    const y = Math.round(normalizedY * screenHeight)

    logger.debug(`click: [${coord[0]}, ${coord[1]}] -> normalized(${normalizedX.toFixed(3)}, ${normalizedY.toFixed(3)}) -> screen(${x}, ${y})`)

    await mouse.move(straightTo(new Point(x, y)))
    await mouse.leftClick()

    return { success: true, data: { coordinate: coord, screenX: x, screenY: y } }
  },
}

export const doubleClickTool: Tool = {
  definition: {
    name: 'left_double',
    description: 'Double click at the specified position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]',
        },
      },
      required: ['coordinate'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const normalizedX = normalizeCoord(coord[0])
    const normalizedY = normalizeCoord(coord[1])

    const x = Math.round(normalizedX * screenWidth)
    const y = Math.round(normalizedY * screenHeight)

    await mouse.move(straightTo(new Point(x, y)))
    await mouse.doubleClick(0)

    return { success: true, data: { coordinate: coord, screenX: x, screenY: y } }
  },
}

export const rightClickTool: Tool = {
  definition: {
    name: 'right_single',
    description: 'Right click at the specified position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]',
        },
      },
      required: ['coordinate'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const normalizedX = normalizeCoord(coord[0])
    const normalizedY = normalizeCoord(coord[1])

    const x = Math.round(normalizedX * screenWidth)
    const y = Math.round(normalizedY * screenHeight)

    await mouse.move(straightTo(new Point(x, y)))
    await mouse.rightClick()

    return { success: true, data: { coordinate: coord, screenX: x, screenY: y } }
  },
}

export const dragTool: Tool = {
  definition: {
    name: 'drag',
    description: 'Drag from start to end position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        startCoordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] start coordinate, range [0, 1000]',
        },
        endCoordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] end coordinate, range [0, 1000]',
        },
      },
      required: ['startCoordinate', 'endCoordinate'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const startCoord = args.startCoordinate as number[]
    const endCoord = args.endCoordinate as number[]

    const startX = Math.round(normalizeCoord(startCoord[0]) * screenWidth)
    const startY = Math.round(normalizeCoord(startCoord[1]) * screenHeight)
    const endX = Math.round(normalizeCoord(endCoord[0]) * screenWidth)
    const endY = Math.round(normalizeCoord(endCoord[1]) * screenHeight)

    await mouse.move(straightTo(new Point(startX, startY)))
    await mouse.drag(straightTo(new Point(endX, endY)))

    return { success: true, data: { startCoordinate: startCoord, endCoordinate: endCoord } }
  },
}

export const scrollTool: Tool = {
  definition: {
    name: 'scroll',
    description: 'Scroll at the specified position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction',
        },
      },
      required: ['coordinate', 'direction'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    const y = Math.round(normalizeCoord(coord[1]) * screenHeight)
    const direction = args.direction as string

    await mouse.move(straightTo(new Point(x, y)))

    const amount = 300
    if (direction === 'up') {
      await mouse.scrollUp(amount)
    } else if (direction === 'down') {
      await mouse.scrollDown(amount)
    } else if (direction === 'left') {
      await mouse.scrollLeft(amount)
    } else if (direction === 'right') {
      await mouse.scrollRight(amount)
    }

    return { success: true, data: { coordinate: coord, direction } }
  },
}

// Export all mouse tools
export const mouseTools: Tool[] = [
  clickTool,
  doubleClickTool,
  rightClickTool,
  dragTool,
  scrollTool,
]
