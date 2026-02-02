import type { Tool } from '../../types.js'
import { logger } from '../../utils/logger.js'

// ============ Mouse Tools ============
// 坐标已在 parseToolCalls 中从 [0,1000] 归一化为 [0,1]
// 执行时乘以 screenWidth/screenHeight 转换为像素坐标

export const clickTool: Tool = {
  definition: {
    name: 'click',
    description: '在指定位置点击鼠标左键',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X 坐标，归一化值 0-1' },
        y: { type: 'number', description: 'Y 坐标，归一化值 0-1' },
      },
      required: ['x', 'y'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const normalizedX = args.x as number
    const normalizedY = args.y as number

    // 转换为屏幕像素坐标
    const x = Math.round(normalizedX * screenWidth)
    const y = Math.round(normalizedY * screenHeight)

    logger.debug(`click: normalized(${normalizedX}, ${normalizedY}) -> screen(${x}, ${y}) [${screenWidth}x${screenHeight}]`)

    await mouse.move(straightTo(new Point(x, y)))
    await mouse.leftClick()

    return { success: true, data: { normalizedX, normalizedY, screenX: x, screenY: y } }
  },
}

export const doubleClickTool: Tool = {
  definition: {
    name: 'double_click',
    description: '在指定位置双击鼠标左键',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X 坐标，归一化值 0-1' },
        y: { type: 'number', description: 'Y 坐标，归一化值 0-1' },
      },
      required: ['x', 'y'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const normalizedX = args.x as number
    const normalizedY = args.y as number

    const x = Math.round(normalizedX * screenWidth)
    const y = Math.round(normalizedY * screenHeight)

    await mouse.move(straightTo(new Point(x, y)))
    await mouse.doubleClick(0)

    return { success: true, data: { normalizedX, normalizedY, screenX: x, screenY: y } }
  },
}

export const rightClickTool: Tool = {
  definition: {
    name: 'right_click',
    description: '在指定位置点击鼠标右键',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X 坐标，归一化值 0-1' },
        y: { type: 'number', description: 'Y 坐标，归一化值 0-1' },
      },
      required: ['x', 'y'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const normalizedX = args.x as number
    const normalizedY = args.y as number

    const x = Math.round(normalizedX * screenWidth)
    const y = Math.round(normalizedY * screenHeight)

    await mouse.move(straightTo(new Point(x, y)))
    await mouse.rightClick()

    return { success: true, data: { normalizedX, normalizedY, screenX: x, screenY: y } }
  },
}

export const mouseMoveTool: Tool = {
  definition: {
    name: 'mouse_move',
    description: '移动鼠标到指定位置',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X 坐标，归一化值 0-1' },
        y: { type: 'number', description: 'Y 坐标，归一化值 0-1' },
      },
      required: ['x', 'y'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const normalizedX = args.x as number
    const normalizedY = args.y as number

    const x = Math.round(normalizedX * screenWidth)
    const y = Math.round(normalizedY * screenHeight)

    await mouse.move(straightTo(new Point(x, y)))

    return { success: true, data: { normalizedX, normalizedY, screenX: x, screenY: y } }
  },
}

export const dragTool: Tool = {
  definition: {
    name: 'drag',
    description: '从起点拖拽到终点',
    parameters: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: '起点 X 坐标，归一化值 0-1' },
        startY: { type: 'number', description: '起点 Y 坐标，归一化值 0-1' },
        endX: { type: 'number', description: '终点 X 坐标，归一化值 0-1' },
        endY: { type: 'number', description: '终点 Y 坐标，归一化值 0-1' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const startX = Math.round((args.startX as number) * screenWidth)
    const startY = Math.round((args.startY as number) * screenHeight)
    const endX = Math.round((args.endX as number) * screenWidth)
    const endY = Math.round((args.endY as number) * screenHeight)

    await mouse.move(straightTo(new Point(startX, startY)))
    await mouse.drag(straightTo(new Point(endX, endY)))

    return { success: true, data: { startX, startY, endX, endY } }
  },
}

export const scrollTool: Tool = {
  definition: {
    name: 'scroll',
    description: '在指定位置滚动',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X 坐标，归一化值 0-1' },
        y: { type: 'number', description: 'Y 坐标，归一化值 0-1' },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: '滚动方向',
        },
        amount: { type: 'number', description: '滚动量 (像素)，默认 300' },
      },
      required: ['x', 'y', 'direction'],
    },
  },
  async execute(args, context) {
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const x = Math.round((args.x as number) * screenWidth)
    const y = Math.round((args.y as number) * screenHeight)
    const direction = args.direction as string
    const amount = (args.amount as number) || 300

    await mouse.move(straightTo(new Point(x, y)))

    if (direction === 'up') {
      await mouse.scrollUp(amount)
    } else if (direction === 'down') {
      await mouse.scrollDown(amount)
    } else if (direction === 'left') {
      await mouse.scrollLeft(amount)
    } else if (direction === 'right') {
      await mouse.scrollRight(amount)
    }

    return { success: true, data: { x, y, direction, amount } }
  },
}

// Export all mouse tools
export const mouseTools: Tool[] = [
  clickTool,
  doubleClickTool,
  rightClickTool,
  mouseMoveTool,
  dragTool,
  scrollTool,
]
