import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';

// Supported languages for syntax highlighting
const SUPPORTED_LANGS: BundledLanguage[] = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'rust',
  'go',
  'python',
  'json',
  'jsonc',
  'bash',
  'sh',
  'shell',
  'markdown',
  'mdx',
  'css',
  'html',
  'xml',
  'yaml',
  'toml',
  'sql',
  'python',
  'docker',
  'diff',
  'plaintext',
];

const THEME = 'github-dark';

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

export function getShikiHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) {
    return Promise.resolve(highlighterInstance);
  }
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: SUPPORTED_LANGS,
    }).then((h) => {
      highlighterInstance = h;
      return h;
    });
  }
  return highlighterPromise;
}

export function highlightCode(code: string, lang: string): string {
  if (!highlighterInstance) {
    return escapeHtml(code);
  }
  const supportedLang = SUPPORTED_LANGS.includes(lang as BundledLanguage) ? lang : 'plaintext';
  try {
    return highlighterInstance.codeToHtml(code, {
      lang: supportedLang,
      theme: THEME,
    });
  } catch {
    return `<pre class="shiki ${THEME}"><code>${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
