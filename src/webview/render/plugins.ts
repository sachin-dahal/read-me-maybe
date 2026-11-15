import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import { Slugger } from './slug';
import { escapeHtml } from './util';

export interface HeadingInfo {
  level: number;
  text: string;
  id: string;
  line: number;
}

export interface RenderEnv {
  headings: HeadingInfo[];
  slugger: Slugger;
  /** Lines of top-level task list items, in document order. */
  taskLines: number[];
}

export function createEnv(): RenderEnv {
  return { headings: [], slugger: new Slugger(), taskLines: [] };
}

function inlineText(token: Token): string {
  return (token.children ?? [])
    .filter((child) => child.type === 'text' || child.type === 'code_inline' || child.type === 'emoji')
    .map((child) => child.content)
    .join('');
}

/** Adds GitHub-style ids to headings and records them for the outline. */
export function headingsPlugin(md: MarkdownIt): void {
  md.core.ruler.push('rmm_headings', (state: StateCore) => {
    const env = state.env as RenderEnv;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'heading_open') {
        continue;
      }
      const inline = tokens[i + 1];
      const text = inline ? inlineText(inline) : '';
      const id = env.slugger.slug(text);
      token.attrSet('id', id);
      env.headings.push({ level: Number(token.tag.slice(1)), text, id, line: token.map?.[0] ?? -1 });
    }
  });

  md.renderer.rules.heading_close = (tokens, idx) => {
    const open = tokens[idx - 2];
    const id = open?.attrGet('id');
    const anchor = id
      ? `<a class="rmm-anchor" href="#${escapeHtml(id)}" aria-label="Link to this section" tabindex="-1">#</a>`
      : '';
    return `${anchor}</${tokens[idx].tag}>\n`;
  };
}

const TASK_RE = /^\[([ xX])\][ \t]/;

/** GitHub task lists: "- [ ] todo" / "- [x] done" become real (clickable) checkboxes. */
export function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'rmm_tasks', (state: StateCore) => {
    const env = state.env as RenderEnv;
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (
        inline.type !== 'inline' ||
        tokens[i - 1].type !== 'paragraph_open' ||
        tokens[i - 2].type !== 'list_item_open'
      ) {
        continue;
      }
      const match = TASK_RE.exec(inline.content);
      const first = inline.children?.[0];
      if (!match || !first || first.type !== 'text' || !TASK_RE.test(first.content)) {
        continue;
      }
      const checked = match[1].toLowerCase() === 'x';
      const line = inline.map?.[0] ?? tokens[i - 2].map?.[0] ?? -1;
      first.content = first.content.replace(TASK_RE, '');
      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content = `<input type="checkbox" class="rmm-task" data-line="${line}"${checked ? ' checked' : ''} aria-label="Toggle task">`;
      inline.children!.unshift(checkbox);

      const item = tokens[i - 2];
      item.attrJoin('class', checked ? 'rmm-task-item is-done' : 'rmm-task-item');
      env.taskLines.push(line);
      // Mark the enclosing list so it can drop its bullets.
      for (let j = i - 3; j >= 0; j--) {
        const t = tokens[j];
        if ((t.type === 'bullet_list_open' || t.type === 'ordered_list_open') && t.level === item.level - 1) {
          if (!(t.attrGet('class') ?? '').includes('rmm-task-list')) {
            t.attrJoin('class', 'rmm-task-list');
          }
          break;
        }
      }
    }
  });
}

const ALERTS: Record<string, { title: string; icon: string }> = {
  note: { title: 'Note', icon: 'info' },
  tip: { title: 'Tip', icon: 'lightbulb' },
  important: { title: 'Important', icon: 'report' },
  warning: { title: 'Warning', icon: 'warning' },
  caution: { title: 'Caution', icon: 'flame' },
};

const ALERT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

/** GitHub alerts: "> [!NOTE]" blockquotes become colourful callouts. */
export function alertsPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'rmm_alerts', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      const open = tokens[i];
      const paragraph = tokens[i + 1];
      const inline = tokens[i + 2];
      if (open.type !== 'blockquote_open' || paragraph.type !== 'paragraph_open' || inline.type !== 'inline') {
        continue;
      }
      const match = ALERT_RE.exec(inline.content);
      if (!match) {
        continue;
      }
      const kind = match[1].toLowerCase();
      const meta = ALERTS[kind];

      // Strip "[!NOTE]" (+ the line break after it) from the inline children.
      let remaining = match[0].replace(/\n$/, '').trimEnd().length;
      const children = inline.children ?? [];
      while (remaining > 0 && children.length > 0 && children[0].type === 'text') {
        const child = children[0];
        if (child.content.length <= remaining) {
          remaining -= child.content.length;
          children.shift();
        } else {
          child.content = child.content.slice(remaining).replace(/^[ \t]+/, '');
          remaining = 0;
        }
      }
      while (children.length > 0 && (children[0].type === 'softbreak' || children[0].type === 'hardbreak')) {
        children.shift();
      }
      if (children.length > 0 && children[0].type === 'text') {
        children[0].content = children[0].content.replace(/^[ \t]+/, '');
      }
      inline.content = inline.content.slice(match[0].length);
      if (children.length === 0) {
        paragraph.hidden = true;
        tokens[i + 3].hidden = true;
      }

      open.tag = 'div';
      open.attrJoin('class', `rmm-alert rmm-alert-${kind}`);
      open.meta = { alert: kind };
      let depth = 0;
      for (let j = i; j < tokens.length; j++) {
        depth += tokens[j].nesting;
        if (depth === 0) {
          tokens[j].tag = 'div';
          break;
        }
      }
      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="rmm-alert-title"><i class="codicon codicon-${meta.icon}"></i>${meta.title}</p>\n`;
      title.level = open.level + 1;
      tokens.splice(i + 1, 0, title);
    }
  });
}
