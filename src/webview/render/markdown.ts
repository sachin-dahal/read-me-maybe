import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { full as emojiPlugin } from 'markdown-it-emoji';
import footnotePlugin from 'markdown-it-footnote';
import frontMatterPlugin from 'markdown-it-front-matter';
import { highlightCode, languageLabel } from './highlight';
import { alertsPlugin, createEnv, headingsPlugin, taskListPlugin, type HeadingInfo, type RenderEnv } from './plugins';
import { escapeHtml, hashString } from './util';

export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'quote'
  | 'alert'
  | 'code'
  | 'mermaid'
  | 'table'
  | 'rule'
  | 'html'
  | 'frontmatter'
  | 'footnotes'
  | 'other';

export interface RenderedBlock {
  /** First source line (inclusive), or -1 for generated content such as footnotes. */
  start: number;
  /** Last source line (exclusive), trailing blank lines trimmed. */
  end: number;
  kind: BlockKind;
  html: string;
  /** Stable identity used to reuse DOM nodes between renders. */
  key: string;
}

export interface RenderResult {
  blocks: RenderedBlock[];
  headings: HeadingInfo[];
}

export function createMarkdown(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
  md.use(frontMatterPlugin, () => undefined);
  md.use(footnotePlugin);
  md.use(emojiPlugin);
  md.use(headingsPlugin);
  md.use(taskListPlugin);
  md.use(alertsPlugin);

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (lang === 'mermaid') {
      return `<div class="rmm-mermaid" data-state="pending"><pre class="rmm-mermaid-source">${escapeHtml(token.content)}</pre></div>\n`;
    }
    return codeCard(token.content, lang);
  };
  md.renderer.rules.code_block = (tokens, idx) => codeCard(tokens[idx].content, '');

  md.renderer.rules.front_matter = (tokens, idx) => {
    const yaml = (tokens[idx] as Token & { meta: string }).meta ?? '';
    return (
      `<details class="rmm-frontmatter"><summary><i class="codicon codicon-symbol-property"></i>Properties</summary>` +
      `<pre class="hljs"><code>${highlightCode(yaml, 'yaml')}</code></pre></details>\n`
    );
  };

  md.renderer.rules.table_open = () => '<div class="rmm-table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('loading', 'lazy');
    return defaultImage(tokens, idx, options, env, self);
  };

  return md;
}

function codeCard(code: string, lang: string): string {
  const content = code.endsWith('\n') ? code.slice(0, -1) : code;
  return (
    `<div class="rmm-code" data-lang="${escapeHtml(lang)}">` +
    `<div class="rmm-code-header"><span class="rmm-code-lang">${escapeHtml(languageLabel(lang))}</span>` +
    `<button class="rmm-icon-btn rmm-code-copy" type="button" title="Copy code" aria-label="Copy code"><i class="codicon codicon-copy"></i></button></div>` +
    `<pre class="hljs"><code>${highlightCode(content, lang)}</code></pre></div>\n`
  );
}

function kindOf(token: Token): BlockKind {
  switch (token.type) {
    case 'paragraph_open':
      return 'paragraph';
    case 'heading_open':
      return 'heading';
    case 'bullet_list_open':
    case 'ordered_list_open':
      return 'list';
    case 'blockquote_open':
      return token.meta?.alert ? 'alert' : 'quote';
    case 'fence':
      return token.info.trim().toLowerCase().startsWith('mermaid') ? 'mermaid' : 'code';
    case 'code_block':
      return 'code';
    case 'table_open':
      return 'table';
    case 'hr':
      return 'rule';
    case 'html_block':
      return 'html';
    case 'front_matter':
      return 'frontmatter';
    case 'footnote_block_open':
      return 'footnotes';
    default:
      return 'other';
  }
}

/** Split the token stream into top-level blocks, each mapped back to its source lines. */
export function renderMarkdown(md: MarkdownIt, source: string): RenderResult {
  const env: RenderEnv = createEnv();
  const tokens = md.parse(source, env);
  const lines = source.split('\n');
  const blocks: RenderedBlock[] = [];

  for (let i = 0; i < tokens.length; ) {
    let j = i;
    if (tokens[i].nesting === 1) {
      let depth = 0;
      for (; j < tokens.length; j++) {
        depth += tokens[j].nesting;
        if (depth === 0) {
          break;
        }
      }
    }
    const first = tokens[i];
    const group = tokens.slice(i, j + 1);
    const html = md.renderer.render(group, md.options, env);
    let start = -1;
    let end = -1;
    if (first.map) {
      [start, end] = first.map;
      while (end > start + 1 && (lines[end - 1] ?? '').trim() === '') {
        end--;
      }
    }
    if (html.trim() !== '') {
      const kind = kindOf(first);
      blocks.push({ start, end, kind, html, key: hashString(`${kind}:${html}`) });
    }
    i = j + 1;
  }

  return { blocks, headings: env.headings };
}

export type { HeadingInfo };
