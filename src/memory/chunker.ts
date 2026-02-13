import type { Chunk } from './types.js';

export interface ChunkOptions {
  maxChars?: number
  // Only index chunks under these headings (case-insensitive). All others are skipped.
  // If not set, all headings are indexed.
  onlyHeadings?: string[]
}

export function chunkMarkdown(content: string, options?: ChunkOptions): Chunk[] {
  const maxChars = options?.maxChars ?? 1600;
  const onlySet = options?.onlyHeadings
    ? new Set(options.onlyHeadings.map(h => h.toLowerCase()))
    : null;

  const lines = content.split('\n');
  const chunks: Chunk[] = [];

  let lineIdx = 0;

  // Skip YAML frontmatter
  if (lines[0] === '---') {
    lineIdx = 1;
    while (lineIdx < lines.length && lines[lineIdx] !== '---') {
      lineIdx++;
    }
    if (lineIdx < lines.length) {
      lineIdx++;
    }
  }

  let currentHeading: string | null = null;
  let bufferLines: string[] = [];
  let bufferStart = lineIdx + 1;
  // When onlyHeadings is set, start in skipping mode (content before first heading is skipped)
  let active = !onlySet;

  function flushBuffer(): void {
    if (bufferLines.length === 0) return;

    const text = bufferLines.join('\n');
    if (text.trim().length === 0) return;

    const startLine = bufferStart;
    const endLine = startLine + bufferLines.length - 1;

    if (text.length <= maxChars) {
      chunks.push({ content: text, heading: currentHeading, startLine, endLine });
    } else {
      splitByParagraphs(text, currentHeading, startLine);
    }

    bufferLines = [];
  }

  function splitByParagraphs(text: string, heading: string | null, baseStartLine: number): void {
    const paragraphs = text.split('\n\n');
    let accum = '';
    let accumLineStart = baseStartLine;
    let lineOffset = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const candidate = accum.length === 0 ? para : accum + '\n\n' + para;

      if (candidate.length > maxChars && accum.length > 0) {
        const accumLineCount = accum.split('\n').length;
        if (accum.trim().length > 0) {
          chunks.push({
            content: accum,
            heading,
            startLine: accumLineStart,
            endLine: accumLineStart + accumLineCount - 1,
          });
        }
        lineOffset += accumLineCount + 1;
        accumLineStart = baseStartLine + lineOffset;
        accum = para;
      } else {
        accum = candidate;
      }
    }

    if (accum.trim().length > 0) {
      const accumLineCount = accum.split('\n').length;
      chunks.push({
        content: accum,
        heading,
        startLine: accumLineStart,
        endLine: accumLineStart + accumLineCount - 1,
      });
    }
  }

  while (lineIdx < lines.length) {
    const line = lines[lineIdx];

    if (line.startsWith('## ')) {
      const headingText = line.slice(3).trim();

      if (onlySet) {
        if (active) flushBuffer();
        active = onlySet.has(headingText.toLowerCase());
      } else {
        flushBuffer();
      }

      if (active) {
        currentHeading = headingText;
        bufferStart = lineIdx + 1;
        bufferLines = [line];
      }
    } else if (active) {
      if (bufferLines.length === 0) {
        bufferStart = lineIdx + 1;
      }
      bufferLines.push(line);
    }

    lineIdx++;
  }

  if (active) flushBuffer();

  return chunks;
}
