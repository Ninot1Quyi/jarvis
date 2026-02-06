/**
 * Lightweight mail parser -- no dependencies, just RFC 2822 basics.
 *
 * Designed for 163/QQ mail in Chinese. Not a full RFC implementation,
 * just enough to extract readable content from real-world emails.
 */

export interface ParsedMail {
  from: string
  to: string
  subject: string
  date: string
  body: string
  contentType: string
}

// -- Public API --

export function parseMail(raw: string): ParsedMail {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const [headerBlock, bodyBlock] = splitHeaderBody(normalized)
  const headers = parseHeaders(headerBlock)

  const from = extractAddress(headers['from'] ?? '')
  const to = extractAddress(headers['to'] ?? '')
  const subject = decodeEncodedWords(headers['subject'] ?? '')
  const date = headers['date'] ?? ''
  const contentType = headers['content-type'] ?? 'text/plain'

  const body = extractBody(bodyBlock, headers)

  return { from, to, subject, date, body, contentType }
}

// -- Header parsing --

function splitHeaderBody(text: string): [string, string] {
  const idx = text.indexOf('\n\n')
  if (idx === -1) return [text, '']
  return [text.slice(0, idx), text.slice(idx + 2)]
}

function parseHeaders(block: string): Record<string, string> {
  // Unfold continuation lines (RFC 2822: lines starting with whitespace)
  const unfolded = block.replace(/\n[ \t]+/g, ' ')
  const headers: Record<string, string> = {}

  for (const line of unfolded.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    headers[key] = value
  }

  return headers
}

function extractAddress(value: string): string {
  // "Display Name" <user@example.com> -> user@example.com
  const angle = value.match(/<([^>]+)>/)
  if (angle) return angle[1].trim()
  // Bare address
  return value.trim()
}

// -- MIME encoded-word decoding (RFC 2047) --

function decodeEncodedWords(text: string): string {
  // =?charset?encoding?payload?=
  return text.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, payload: string) => {
    const cs = charset.toLowerCase()
    const enc = encoding.toUpperCase()

    let bytes: Uint8Array
    if (enc === 'B') {
      bytes = decodeBase64ToBytes(payload)
    } else {
      bytes = decodeQEncodedToBytes(payload)
    }

    return decodeBytes(bytes, cs)
  })
}

function decodeQEncodedToBytes(text: string): Uint8Array {
  // Q-encoding: _ = space, =XX = hex byte
  const replaced = text.replace(/_/g, ' ')
  const parts: number[] = []
  let i = 0
  while (i < replaced.length) {
    if (replaced[i] === '=' && i + 2 < replaced.length) {
      parts.push(parseInt(replaced.slice(i + 1, i + 3), 16))
      i += 3
    } else {
      parts.push(replaced.charCodeAt(i))
      i++
    }
  }
  return new Uint8Array(parts)
}

// -- Base64 --

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes
}

function decodeBase64(b64: string, charset: string): string {
  return decodeBytes(decodeBase64ToBytes(b64), charset)
}

// -- Quoted-Printable --

function decodeQuotedPrintable(text: string): Uint8Array {
  // Remove soft line breaks
  const joined = text.replace(/=\n/g, '')
  const parts: number[] = []
  let i = 0
  while (i < joined.length) {
    if (joined[i] === '=' && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3)
      const val = parseInt(hex, 16)
      if (!isNaN(val)) {
        parts.push(val)
        i += 3
        continue
      }
    }
    parts.push(joined.charCodeAt(i))
    i++
  }
  return new Uint8Array(parts)
}

// -- Charset decoding --

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const cs = normalizeCharset(charset)
  try {
    return new TextDecoder(cs).decode(bytes)
  } catch {
    // Fallback to utf-8
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function normalizeCharset(charset: string): string {
  const lower = charset.toLowerCase().replace(/[^a-z0-9]/g, '')
  // Map common aliases to TextDecoder-recognized names
  if (lower === 'gb2312' || lower === 'gbk' || lower === 'gb18030') return 'gbk'
  if (lower === 'utf8') return 'utf-8'
  if (lower === 'usascii' || lower === 'ascii') return 'utf-8'
  return charset.toLowerCase()
}

// -- Body extraction --

function extractBody(bodyBlock: string, headers: Record<string, string>): string {
  const ct = headers['content-type'] ?? 'text/plain'
  const cte = (headers['content-transfer-encoding'] ?? '').toLowerCase().trim()
  const charset = extractCharset(ct)

  if (isMultipart(ct)) {
    return extractMultipartBody(bodyBlock, ct)
  }

  const decoded = decodeTransferEncoding(bodyBlock, cte, charset)

  if (ct.toLowerCase().includes('text/html')) {
    return stripHtml(decoded)
  }

  return decoded
}

function isMultipart(ct: string): boolean {
  return ct.toLowerCase().includes('multipart/')
}

function extractCharset(ct: string): string {
  const match = ct.match(/charset\s*=\s*"?([^";,\s]+)"?/i)
  return match ? match[1] : 'utf-8'
}

function extractBoundary(ct: string): string {
  const match = ct.match(/boundary\s*=\s*"?([^";,\s]+)"?/i)
  return match ? match[1] : ''
}

function decodeTransferEncoding(text: string, encoding: string, charset: string): string {
  if (encoding === 'base64') {
    // Strip whitespace from base64 content
    const clean = text.replace(/\s/g, '')
    return decodeBase64(clean, charset)
  }
  if (encoding === 'quoted-printable') {
    const bytes = decodeQuotedPrintable(text)
    return decodeBytes(bytes, charset)
  }
  // 7bit, 8bit, binary -- treat as-is
  return text
}

// -- Multipart parsing --

function extractMultipartBody(body: string, contentType: string): string {
  const boundary = extractBoundary(contentType)
  if (!boundary) return body

  const parts = splitMultipartParts(body, boundary)

  // First pass: look for text/plain
  for (const part of parts) {
    const [hdrBlock, partBody] = splitHeaderBody(part)
    const hdrs = parseHeaders(hdrBlock)
    const ct = hdrs['content-type'] ?? ''
    if (ct.toLowerCase().includes('text/plain')) {
      return decodePart(partBody, hdrs)
    }
  }

  // Second pass: look for text/html
  for (const part of parts) {
    const [hdrBlock, partBody] = splitHeaderBody(part)
    const hdrs = parseHeaders(hdrBlock)
    const ct = hdrs['content-type'] ?? ''
    if (ct.toLowerCase().includes('text/html')) {
      return stripHtml(decodePart(partBody, hdrs))
    }
  }

  // Third pass: recurse into nested multipart
  for (const part of parts) {
    const [hdrBlock, partBody] = splitHeaderBody(part)
    const hdrs = parseHeaders(hdrBlock)
    const ct = hdrs['content-type'] ?? ''
    if (isMultipart(ct)) {
      const result = extractMultipartBody(partBody, ct)
      if (result) return result
    }
  }

  return ''
}

function splitMultipartParts(body: string, boundary: string): string[] {
  const delim = '--' + boundary
  const end = delim + '--'
  const parts: string[] = []

  const segments = body.split(delim)
  for (const seg of segments) {
    const trimmed = seg.replace(/^\n/, '')
    // Skip preamble (before first boundary) and epilogue (after closing boundary)
    if (trimmed === '' || trimmed.startsWith('--')) continue
    // Remove trailing -- marker if present
    const cleaned = trimmed.replace(/\n?--$/, '')
    parts.push(cleaned)
  }

  return parts
}

function decodePart(body: string, headers: Record<string, string>): string {
  const ct = headers['content-type'] ?? 'text/plain'
  const cte = (headers['content-transfer-encoding'] ?? '').toLowerCase().trim()
  const charset = extractCharset(ct)
  return decodeTransferEncoding(body, cte, charset)
}

// -- HTML stripping --

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
