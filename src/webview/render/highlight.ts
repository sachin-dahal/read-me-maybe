import hljs from 'highlight.js/lib/common';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import powershell from 'highlight.js/lib/languages/powershell';
import { escapeHtml } from './util';

hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('powershell', powershell);

const ALIASES: Record<string, string> = {
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  console: 'bash',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  ps1: 'powershell',
  docker: 'dockerfile',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  rs: 'rust',
  kt: 'kotlin',
  rb: 'ruby',
  jsonc: 'json',
  json5: 'json',
};

const LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  bash: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  markdown: 'Markdown',
  csharp: 'C#',
  cpp: 'C++',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ruby: 'Ruby',
  php: 'PHP',
  sql: 'SQL',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  powershell: 'PowerShell',
  plaintext: 'Text',
};

export function resolveLanguage(lang: string): string | undefined {
  const id = ALIASES[lang] ?? lang;
  return id && hljs.getLanguage(id) ? id : undefined;
}

export function languageLabel(lang: string): string {
  if (!lang) {
    return 'Text';
  }
  const id = resolveLanguage(lang);
  return (id && LABELS[id]) ?? lang;
}

export function highlightCode(code: string, lang: string): string {
  const id = resolveLanguage(lang);
  if (!id) {
    return escapeHtml(code);
  }
  try {
    return hljs.highlight(code, { language: id, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}
