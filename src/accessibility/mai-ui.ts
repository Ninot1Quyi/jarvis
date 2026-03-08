/**
 * MAI-UI Visual Grounding Provider
 *
 * Uses the maternion/mai-ui:2b local vision model via ollama to locate UI elements
 * from screenshots when localAgent is configured. The model returns pixel coordinates
 * in [0, 999] range which are converted to screen pixels using actual screen dimensions.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as https from 'https'
import * as http from 'http'
import type { AccessibilitySearchResult } from './types.js'

const execAsync = promisify(exec)

const MAI_UI_SYS_PROMPT = `You are a GUI grounding agent.
## Task
Given a screenshot and the user's grounding instruction. Your task is to accurately locate a UI element based on the user's instructions.
First, you should carefully examine the screenshot and analyze the user's instructions,  translate the user's instruction into a effective reasoning process, and then provide the final coordinate.
## Output Format
Return a json object with a reasoning process in <grounding_think></grounding_think> tags, a [x,y] format coordinate within <answer></answer> XML tags:
<grounding_think>...</grounding_think>
<answer>
{"coordinate": [x,y]}
</answer>`

const SCALE_FACTOR = 999

interface GroundingResult {
  coordinate: [number, number] | null
  thinking: string | null
}

function parseGroundingResponse(text: string): GroundingResult {
  const result: GroundingResult = { coordinate: null, thinking: null }

  const thinkMatch = text.match(/<grounding_think>([\s\S]*?)<\/grounding_think>/)
  if (thinkMatch) {
    result.thinking = thinkMatch[1].trim()
  }

  const answerMatch = text.match(/<answer>([\s\S]*?)<\/answer>/)
  if (answerMatch) {
    try {
      const parsed = JSON.parse(answerMatch[1].trim())
      const coords = parsed.coordinate
      if (Array.isArray(coords) && coords.length === 2) {
        result.coordinate = [Number(coords[0]), Number(coords[1])]
      }
    } catch {
      // parse failed
    }
  }

  return result
}

async function callOllamaGrounding(
  baseUrl: string,
  model: string,
  instruction: string,
  imageBase64: string
): Promise<string> {
  const payload = JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content: [{ type: 'text', text: MAI_UI_SYS_PROMPT }],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction + '\n' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      },
    ],
    max_tokens: 512,
    temperature: 0.0,
    stream: false,
  })

  const url = new URL('/v1/chat/completions', baseUrl)
  const isHttps = url.protocol === 'https:'
  const lib = isHttps ? https : http

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer empty',
        'Content-Length': Buffer.byteLength(payload),
      },
    }

    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          const content = body?.choices?.[0]?.message?.content
          if (typeof content === 'string') {
            resolve(content.trim())
          } else {
            reject(new Error(`Unexpected response: ${JSON.stringify(body).slice(0, 200)}`))
          }
        } catch (err) {
          reject(err)
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(30000, () => {
      req.destroy(new Error('mai-ui request timed out'))
    })
    req.write(payload)
    req.end()
  })
}

/**
 * Take a screenshot and return it as a base64 PNG string.
 * The temp file is deleted immediately after reading.
 */
export async function captureScreenToBase64(): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `jarvis-maiui-${Date.now()}.png`)
  try {
    if (process.platform === 'darwin') {
      await execAsync(`screencapture -C -x "${tmpFile}"`)
    } else if (process.platform === 'win32') {
      const escapedPath = tmpFile.replace(/\\/g, '\\\\')
      const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$graphics.Dispose()
$bitmap.Save("${escapedPath}", [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
`
      const encoded = Buffer.from(ps, 'utf16le').toString('base64')
      await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`)
    } else {
      // Linux
      try {
        await execAsync(`scrot -m "${tmpFile}"`)
      } catch {
        try {
          await execAsync(`gnome-screenshot -f "${tmpFile}"`)
        } catch {
          const { screen, saveImage } = await import('@computer-use/nut-js')
          const image = await screen.grab()
          await saveImage({ image, path: tmpFile })
        }
      }
    }
    return fs.readFileSync(tmpFile).toString('base64')
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

/**
 * Search for a UI element using the mai-ui visual grounding model.
 *
 * @param keyword - Description of the element to find
 * @param imageBase64 - Base64-encoded PNG of the current screen
 * @param screenWidth - Screen width in pixels
 * @param screenHeight - Screen height in pixels
 * @param baseUrl - Ollama base URL (e.g. http://127.0.0.1:11434)
 * @param model - Model name (e.g. maternion/mai-ui:2b)
 */
export async function searchWithMaiUI(
  keyword: string,
  imageBase64: string,
  screenWidth: number,
  screenHeight: number,
  baseUrl: string,
  model: string
): Promise<AccessibilitySearchResult> {
  const startTime = Date.now()

  let rawResponse: string
  try {
    rawResponse = await callOllamaGrounding(baseUrl, model, keyword, imageBase64)
  } catch (err) {
    return {
      success: false,
      error: `mai-ui API call failed: ${err instanceof Error ? err.message : String(err)}`,
      results: [],
      searchKeyword: keyword,
      queryTimeMs: Date.now() - startTime,
    }
  }

  const parsed = parseGroundingResponse(rawResponse)

  if (!parsed.coordinate) {
    return {
      success: false,
      error: `mai-ui could not locate element: ${keyword}`,
      results: [],
      searchKeyword: keyword,
      queryTimeMs: Date.now() - startTime,
    }
  }

  // Model returns [0, 999] range — convert to screen pixels
  const [normX, normY] = parsed.coordinate
  const pixelX = Math.round((normX / SCALE_FACTOR) * screenWidth)
  const pixelY = Math.round((normY / SCALE_FACTOR) * screenHeight)

  return {
    success: true,
    results: [
      {
        role: 'button',
        rawRole: 'mai-ui',
        title: keyword,
        center: [pixelX, pixelY],
        size: [1, 1],
        bounds: [pixelX, pixelY, 1, 1],
        distance: 0,
        interactive: true,
        similarity: 1.0,
      },
    ],
    searchKeyword: keyword,
    queryTimeMs: Date.now() - startTime,
  }
}

/**
 * Verify and correct a single coordinate using mai-ui visual grounding.
 *
 * @param desc - Description of what we're clicking/targeting (element label or llmResponse context)
 * @param normCoord - Current coordinate in [0,1000] normalized range [x, y]
 * @param currentPixelX - Current screen pixel X
 * @param currentPixelY - Current screen pixel Y
 * @param screenWidth - Screen width in pixels
 * @param screenHeight - Screen height in pixels
 * @param baseUrl - Ollama base URL
 * @param model - Model name
 * @param imageBase64 - Optional: pre-captured screenshot base64 (to avoid re-capturing)
 * @returns Corrected { x, y } in screen pixels, or null if no correction needed
 */
export async function verifyCoordinateWithMaiUI(
  desc: string,
  normCoord: number[],
  currentPixelX: number,
  currentPixelY: number,
  screenWidth: number,
  screenHeight: number,
  baseUrl: string,
  model: string,
  imageBase64?: string
): Promise<{ x: number; y: number } | null> {
  let img: string
  if (imageBase64) {
    img = imageBase64
  } else {
    try {
      img = await captureScreenToBase64()
    } catch {
      return null
    }
  }

  const currentNorm999X = Math.round((normCoord[0] / 1000) * SCALE_FACTOR)
  const currentNorm999Y = Math.round((normCoord[1] / 1000) * SCALE_FACTOR)
  const instruction = `Locate the UI element: "${desc}". I believe it is near [${currentNorm999X}, ${currentNorm999Y}] but there may be a slight offset. Find the precise center coordinate of this element, correcting any small positioning error.`

  let rawResponse: string
  try {
    rawResponse = await callOllamaGrounding(baseUrl, model, instruction, img)
  } catch {
    return null
  }

  const parsed = parseGroundingResponse(rawResponse)
  if (!parsed.coordinate) return null

  const [normX, normY] = parsed.coordinate
  const pixelX = Math.round((normX / SCALE_FACTOR) * screenWidth)
  const pixelY = Math.round((normY / SCALE_FACTOR) * screenHeight)

  if (pixelX === currentPixelX && pixelY === currentPixelY) return null

  return { x: pixelX, y: pixelY }
}

/**
 * Verify and correct drag start/end coordinates using mai-ui visual grounding.
 *
 * When no desc is available, uses the LLM's response text from the current step
 * to understand the drag intent, then asks mai-ui to verify both endpoints.
 *
 * One screenshot is taken and reused for both start and end verification.
 *
 * @param llmResponse - The full LLM response text from the current step (provides drag context)
 * @param startNorm - Start coordinate in [0,1000] normalized range [x, y]
 * @param endNorm - End coordinate in [0,1000] normalized range [x, y]
 * @param startPixelX - Current start screen pixel X
 * @param startPixelY - Current start screen pixel Y
 * @param endPixelX - Current end screen pixel X
 * @param endPixelY - Current end screen pixel Y
 * @param screenWidth - Screen width in pixels
 * @param screenHeight - Screen height in pixels
 * @param baseUrl - Ollama base URL
 * @param model - Model name
 * @returns Corrected { startX, startY, endX, endY } in screen pixels, or null if no correction
 */
export async function verifyDragWithMaiUI(
  llmResponse: string,
  startNorm: number[],
  endNorm: number[],
  startPixelX: number,
  startPixelY: number,
  endPixelX: number,
  endPixelY: number,
  screenWidth: number,
  screenHeight: number,
  baseUrl: string,
  model: string
): Promise<{ startX: number; startY: number; endX: number; endY: number } | null> {
  let imageBase64: string
  try {
    imageBase64 = await captureScreenToBase64()
  } catch {
    return null
  }

  // Summarize drag intent from LLM response (first 300 chars to keep prompt short)
  const context = llmResponse.trim().slice(0, 300).replace(/\n+/g, ' ')

  // Convert to [0,999] scale for the model
  const s999X = Math.round((startNorm[0] / 1000) * SCALE_FACTOR)
  const s999Y = Math.round((startNorm[1] / 1000) * SCALE_FACTOR)
  const e999X = Math.round((endNorm[0] / 1000) * SCALE_FACTOR)
  const e999Y = Math.round((endNorm[1] / 1000) * SCALE_FACTOR)

  // Ask model to verify start coordinate
  const startInstruction = `Context: ${context}\n\nI am about to drag from [${s999X}, ${s999Y}] to [${e999X}, ${e999Y}]. Locate the drag START element (the item being dragged) near [${s999X}, ${s999Y}]. Correct any slight offset and return its precise center coordinate.`

  let startRaw: string
  try {
    startRaw = await callOllamaGrounding(baseUrl, model, startInstruction, imageBase64)
  } catch {
    return null
  }

  // Ask model to verify end coordinate (reuse same screenshot)
  const endInstruction = `Context: ${context}\n\nI am about to drag from [${s999X}, ${s999Y}] to [${e999X}, ${e999Y}]. Locate the drag END target (the drop destination) near [${e999X}, ${e999Y}]. Correct any slight offset and return its precise center coordinate.`

  let endRaw: string
  try {
    endRaw = await callOllamaGrounding(baseUrl, model, endInstruction, imageBase64)
  } catch {
    return null
  }

  const startParsed = parseGroundingResponse(startRaw)
  const endParsed = parseGroundingResponse(endRaw)

  if (!startParsed.coordinate && !endParsed.coordinate) return null

  const newStartX = startParsed.coordinate
    ? Math.round((startParsed.coordinate[0] / SCALE_FACTOR) * screenWidth)
    : startPixelX
  const newStartY = startParsed.coordinate
    ? Math.round((startParsed.coordinate[1] / SCALE_FACTOR) * screenHeight)
    : startPixelY
  const newEndX = endParsed.coordinate
    ? Math.round((endParsed.coordinate[0] / SCALE_FACTOR) * screenWidth)
    : endPixelX
  const newEndY = endParsed.coordinate
    ? Math.round((endParsed.coordinate[1] / SCALE_FACTOR) * screenHeight)
    : endPixelY

  // Return null if nothing actually changed
  if (newStartX === startPixelX && newStartY === startPixelY && newEndX === endPixelX && newEndY === endPixelY) {
    return null
  }

  return { startX: newStartX, startY: newStartY, endX: newEndX, endY: newEndY }
}
