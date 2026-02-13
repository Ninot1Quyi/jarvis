import type { SearchResult } from './types.js'

export interface HybridSearchOptions {
  vectorWeight: number    // default 0.7
  textWeight: number      // default 0.3
  minScore: number        // default 0.35
  maxResults: number      // default 6
  snippetMaxChars: number // default 700
  candidateMultiplier: number // default 4
}

export const DEFAULT_SEARCH_OPTIONS: HybridSearchOptions = {
  vectorWeight: 0.7,
  textWeight: 0.3,
  minScore: 0.35,
  maxResults: 6,
  snippetMaxChars: 700,
  candidateMultiplier: 4,
}

/**
 * Merge hybrid results from vector and keyword search.
 * Final score = vectorWeight * vectorScore + textWeight * textScore
 * Weights are normalized to sum to 1.0
 */
export function mergeHybridResults(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  options: HybridSearchOptions
): SearchResult[] {
  const { vectorWeight, textWeight, minScore, maxResults, snippetMaxChars } = options
  const totalWeight = vectorWeight + textWeight
  const vw = vectorWeight / totalWeight
  const tw = textWeight / totalWeight

  // Build map by unique key (path:startLine)
  const merged = new Map<string, SearchResult & { vScore: number; tScore: number }>()

  for (const r of vectorResults) {
    const key = `${r.path}:${r.startLine}`
    merged.set(key, { ...r, vScore: r.score, tScore: 0 })
  }

  for (const r of keywordResults) {
    const key = `${r.path}:${r.startLine}`
    const existing = merged.get(key)
    if (existing) {
      existing.tScore = r.score
    } else {
      merged.set(key, { ...r, vScore: 0, tScore: r.score })
    }
  }

  // Compute final scores
  const results: SearchResult[] = []
  for (const [, entry] of merged) {
    const score = vw * entry.vScore + tw * entry.tScore
    if (score >= minScore) {
      // Truncate snippet safely (don't split surrogate pairs)
      let snippet = entry.snippet
      if (snippet.length > snippetMaxChars) {
        let end = snippetMaxChars
        if (end > 0 && snippet.charCodeAt(end - 1) >= 0xD800 && snippet.charCodeAt(end - 1) <= 0xDBFF) {
          end--
        }
        snippet = snippet.slice(0, end) + '...'
      }
      results.push({ ...entry, score, snippet })
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, maxResults)
}
