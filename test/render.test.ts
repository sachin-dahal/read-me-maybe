import { describe, expect, it } from 'vitest';
import { createMarkdown, renderMarkdown } from '../src/webview/render/markdown';
import { readingStats } from '../src/webview/render/stats';
import { Slugger } from '../src/webview/render/slug';

const md = createMarkdown();

describe('renderMarkdown blocks', () => {
  it('maps every top-level block to its source lines', () => {
    const source = [
      '# Title', // 0
      '', // 1
      'First paragraph', // 2
      'continues here.', // 3
      '', // 4
      '- one', // 5
      '- two', // 6
      '', // 7
      '```ts', // 8
      'const x = 1;', // 9
      '```', // 10
      '',
    ].join('\n');
    const { blocks } = renderMarkdown(md, source);
    expect(blocks.map((b) => [b.kind, b.start, b.end])).toEqual([
      ['heading', 0, 1],
      ['paragraph', 2, 4],
      ['list', 5, 7],
      ['code', 8, 11],
    ]);
  });

  it('trims trailing blank lines from loose lists', () => {
    const source = '- a\n\n- b\n\n\nAfter\n';
    const { blocks } = renderMarkdown(md, source);
    expect(blocks[0]).toMatchObject({ kind: 'list', start: 0, end: 3 });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', start: 5, end: 6 });
  });

  it('renders mermaid fences as placeholders', () => {
    const { blocks } = renderMarkdown(md, '```mermaid\ngraph TD; A-->B\n```\n');
    expect(blocks[0].kind).toBe('mermaid');
    expect(blocks[0].html).toContain('rmm-mermaid-source');
    expect(blocks[0].html).toContain('A--&gt;B');
  });

  it('keeps keys stable for unchanged blocks', () => {
    const a = renderMarkdown(md, 'Hello\n\nWorld\n').blocks;
    const b = renderMarkdown(md, 'Hello\n\nWorld!\n').blocks;
    expect(a[0].key).toBe(b[0].key);
    expect(a[1].key).not.toBe(b[1].key);
  });

  it('marks footnotes as generated (non-editable)', () => {
    const { blocks } = renderMarkdown(md, 'Text[^1]\n\n[^1]: The note.\n');
    expect(blocks.at(-1)).toMatchObject({ kind: 'footnotes', start: -1 });
  });

  it('maps front matter', () => {
    const { blocks } = renderMarkdown(md, '---\ntitle: Hi\n---\n\n# Doc\n');
    expect(blocks[0]).toMatchObject({ kind: 'frontmatter', start: 0, end: 3 });
    expect(blocks[1]).toMatchObject({ kind: 'heading', start: 4 });
  });
});

describe('plugins', () => {
  it('renders task lists with source line numbers', () => {
    const { blocks } = renderMarkdown(md, 'Intro\n\n- [ ] todo\n- [x] done\n');
    const html = blocks[1].html;
    expect(html).toContain('rmm-task-list');
    expect(html).toContain('data-line="2"');
    expect(html).toMatch(/data-line="3" checked/);
    expect(html).not.toContain('[ ]');
  });

  it('renders GitHub alerts', () => {
    const { blocks } = renderMarkdown(md, '> [!WARNING]\n> Hot coffee.\n');
    expect(blocks[0].kind).toBe('alert');
    expect(blocks[0].html).toContain('rmm-alert-warning');
    expect(blocks[0].html).toContain('Hot coffee.');
    expect(blocks[0].html).not.toContain('[!WARNING]');
    expect(blocks[0].html).not.toContain('<blockquote');
  });

  it('leaves normal blockquotes alone', () => {
    const { blocks } = renderMarkdown(md, '> Just a quote\n');
    expect(blocks[0].kind).toBe('quote');
    expect(blocks[0].html).toContain('<blockquote>');
  });

  it('collects headings with unique ids', () => {
    const { headings } = renderMarkdown(md, '# Intro\n\n## Setup\n\n## Setup\n\n### `npm` & you\n');
    expect(headings.map((h) => h.id)).toEqual(['intro', 'setup', 'setup-1', 'npm--you']);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 2, 3]);
  });

  it('highlights code and labels the language', () => {
    const { blocks } = renderMarkdown(md, '```js\nconst a = 1;\n```\n');
    expect(blocks[0].html).toContain('hljs-keyword');
    expect(blocks[0].html).toContain('JavaScript');
  });

  it('supports emoji shortcodes', () => {
    const { blocks } = renderMarkdown(md, 'Ship it :rocket:\n');
    expect(blocks[0].html).toContain('🚀');
  });
});

describe('helpers', () => {
  it('slugs like GitHub', () => {
    const s = new Slugger();
    expect(s.slug('Hello, World!')).toBe('hello-world');
    expect(s.slug('Hello, World!')).toBe('hello-world-1');
    expect(s.slug('Ünïcode Stays')).toBe('ünïcode-stays');
  });

  it('counts words but not code', () => {
    const stats = readingStats('# Title\n\nOne two three.\n\n```js\nconst ignored = true;\n```\n');
    expect(stats.words).toBe(4);
    expect(stats.minutes).toBe(1);
  });
});

describe('html containers', () => {
  it('keeps <details> and its markdown body in one block', () => {
    const source = '<details>\n<summary>Secret</summary>\n\nHidden **text**.\n\n</details>\n\nAfter\n';
    const { blocks } = renderMarkdown(md, source);
    expect(blocks.map((b) => [b.kind, b.start, b.end])).toEqual([
      ['html', 0, 6],
      ['paragraph', 7, 8],
    ]);
    expect(blocks[0].html).toContain('<strong>text</strong>');
  });

  it('keeps centered README headers together', () => {
    const source = '<div align="center">\n\n# Title\n\n<img src="x.png">\n\n</div>\n';
    const { blocks } = renderMarkdown(md, source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].html).toMatch(/<div align="center">[\s\S]*<h1[\s\S]*<\/div>/);
  });

  it('counts html depth', async () => {
    const { htmlDepthDelta } = await import('../src/webview/render/markdown');
    expect(htmlDepthDelta('<details>\n<summary>Hi</summary>')).toBe(1);
    expect(htmlDepthDelta('<p align="center"><img src="a.png"><br/></p>')).toBe(0);
    expect(htmlDepthDelta('<!-- <div> -->')).toBe(0);
    expect(htmlDepthDelta('</div>')).toBe(-1);
  });
});
