import * as crypto from 'crypto';
import type { Chunk } from './types.js';

export interface ChunkOptions {
  maxChars?: number        // default 1600 (= 400 tokens * 4)
  overlapChars?: number    // default 320 (= 80 tokens * 4), overlap between consecutive chunks
  // Only index chunks under these headings (case-insensitive). All others are skipped.
  // If not set, all headings are indexed.
  onlyHeadings?: string[]
}

function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function chunkMarkdown(content: string, options?: ChunkOptions): Chunk[] {
  const maxChars = options?.maxChars ?? 1600;
  const overlapChars = options?.overlapChars ?? 320;
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

  function carryOverlap(flushedLines: string[]): void {
    if (overlapChars <= 0 || flushedLines.length === 0) return;

    const flushedText = flushedLines.join('\n');
    // If overlap >= chunk size, skip overlap to avoid infinite loops
    if (overlapChars >= flushedText.length) return;

    let charCount = 0;
    let overlapStart = flushedLines.length;

    for (let i = flushedLines.length - 1; i >= 0; i--) {
      const lineLen = flushedLines[i].length + (i < flushedLines.length - 1 ? 1 : 0); // +1 for \n
      if (charCount + lineLen > overlapChars) break;
      charCount += lineLen;
      overlapStart = i;
    }

    if (overlapStart < flushedLines.length) {
      bufferLines = flushedLines.slice(overlapStart);
      bufferStart = bufferStart + overlapStart;
    }
  }

  function pushChunk(text: string, heading: string | null, startLine: number, endLine: number): void {
    chunks.push({ content: text, heading, startLine, endLine, hash: hashContent(text) });
  }

  function flushBuffer(headingBoundary: boolean): void {
    if (bufferLines.length === 0) return;

    const text = bufferLines.join('\n');
    if (text.trim().length === 0) {
      bufferLines = [];
      return;
    }

    const startLine = bufferStart;
    const endLine = startLine + bufferLines.length - 1;
    const flushedLines = bufferLines;

    if (text.length <= maxChars) {
      pushChunk(text, currentHeading, startLine, endLine);
    } else {
      splitByParagraphs(text, currentHeading, startLine);
    }

    bufferLines = [];
    // No overlap across heading boundaries
    if (!headingBoundary) {
      carryOverlap(flushedLines);
    }
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
          pushChunk(accum, heading, accumLineStart, accumLineStart + accumLineCount - 1);
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
      pushChunk(accum, heading, accumLineStart, accumLineStart + accumLineCount - 1);
    }
  }

  while (lineIdx < lines.length) {
    const line = lines[lineIdx];

    if (line.startsWith('## ')) {
      const headingText = line.slice(3).trim();

      if (onlySet) {
        if (active) flushBuffer(true);
        active = onlySet.has(headingText.toLowerCase());
      } else {
        flushBuffer(true);
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

  if (active) flushBuffer(true);

  return chunks;
}
