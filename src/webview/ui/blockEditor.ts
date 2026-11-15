import { collapseBlankLine, lineCount } from '../../shared/lines';
import type { LineEdit } from '../../shared/protocol';
import type { BlockKind } from '../render/markdown';
import { button, h, isMod, MOD } from './dom';
import * as fmt from './formatting';

export interface EditorHost {
  sendEdit(edit: LineEdit): void;
  currentSource(): string;
  requestClose(editor: BlockEditor): void;
  save(): void;
}

const MONO_KINDS: ReadonlySet<BlockKind> = new Set(['code', 'mermaid', 'table', 'html', 'frontmatter']);
const COMMIT_DELAY = 120;

/**
 * Edits one block in place: the rendered block is swapped for its raw Markdown.
 * Changes are committed to the document as you type (debounced), so VS Code's
 * dirty state, save and other open editors stay in sync.
 */
export class BlockEditor {
  readonly el: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  private committed: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly host: EditorHost,
    readonly blockEl: HTMLElement,
    public start: number,
    public end: number,
    text: string,
    kind: BlockKind,
    caret?: number,
  ) {
    this.committed = text;
    this.textarea = h('textarea', {
      class: `rmm-editor-input${MONO_KINDS.has(kind) ? ' is-mono' : ''}`,
      attrs: {
        spellcheck: MONO_KINDS.has(kind) ? 'false' : 'true',
        'aria-label': 'Edit Markdown block',
        placeholder: text === '' ? 'Start typing. Markdown is welcome here ✨' : 'Empty block. Esc removes it',
        rows: '1',
      },
    });
    this.textarea.value = text;
    this.el = h('div', { class: 'rmm-editor' }, this.buildBar(), this.textarea);

    this.textarea.addEventListener('input', () => this.onInput());
    this.textarea.addEventListener('keydown', (e) => this.onKeyDown(e));

    blockEl.classList.add('is-editing');
    blockEl.append(this.el);
    this.autosize();
    this.textarea.focus({ preventScroll: true });
    const pos = Math.max(0, Math.min(caret ?? text.length, text.length));
    this.textarea.setSelectionRange(pos, pos);
    this.ensureVisible();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Push pending text to the document right away. */
  commit(): void {
    clearTimeout(this.timer);
    if (this.disposed) {
      return;
    }
    const value = this.textarea.value;
    if (value === this.committed) {
      return;
    }
    this.host.sendEdit({ start: this.start, end: this.end, oldText: this.committed, newText: value });
    this.committed = value;
    this.end = this.start + lineCount(value);
  }

  /** Commit, tidy up an emptied block, and remove the editor. */
  finish(): void {
    if (this.disposed) {
      return;
    }
    this.commit();
    if (this.committed.trim() === '') {
      if (this.end > this.start) {
        this.host.sendEdit({ start: this.start, end: this.end, oldText: this.committed, newText: '' });
        this.committed = '';
        this.end = this.start;
      }
      const cleanup = collapseBlankLine(this.host.currentSource(), this.start);
      if (cleanup) {
        this.host.sendEdit(cleanup);
      }
    }
    this.dispose();
  }

  /** Remove the editor without committing (the document changed underneath us). */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    clearTimeout(this.timer);
    this.el.remove();
    this.blockEl.classList.remove('is-editing');
    if (this.blockEl.classList.contains('is-new')) {
      this.blockEl.remove();
    }
  }

  get caret(): number {
    return this.textarea.selectionStart;
  }

  private buildBar(): HTMLElement {
    const run = (fn: (state: fmt.TextState) => fmt.TextChange) => () => this.apply(fn(this.state()));
    const group = (...nodes: Node[]) => h('div', { class: 'rmm-editor-group' }, ...nodes);
    return h(
      'div',
      { class: 'rmm-editor-bar' },
      group(
        button({ icon: 'bold', title: `Bold (${MOD}B)`, onClick: run((s) => fmt.toggleInline(s, 'bold')) }),
        button({ icon: 'italic', title: `Italic (${MOD}I)`, onClick: run((s) => fmt.toggleInline(s, 'italic')) }),
        button({ icon: 'strikethrough', title: `Strikethrough (${MOD}Shift+X)`, onClick: run((s) => fmt.toggleInline(s, 'strike')) }),
        button({ icon: 'code', title: 'Inline code', onClick: run((s) => fmt.toggleInline(s, 'code')) }),
        button({ icon: 'link', title: `Link (${MOD}K)`, onClick: run(fmt.insertLink) }),
      ),
      h('span', { class: 'rmm-editor-sep' }),
      group(
        button({ label: 'H', class: 'rmm-heading-btn', title: 'Cycle heading level', onClick: run((s) => fmt.toggleLinePrefix(s, 'heading')) }),
        button({ icon: 'list-unordered', title: 'Bulleted list', onClick: run((s) => fmt.toggleLinePrefix(s, 'bullet')) }),
        button({ icon: 'list-ordered', title: 'Numbered list', onClick: run((s) => fmt.toggleLinePrefix(s, 'ordered')) }),
        button({ icon: 'tasklist', title: 'Task list', onClick: run((s) => fmt.toggleLinePrefix(s, 'task')) }),
        button({ icon: 'quote', title: 'Quote', onClick: run((s) => fmt.toggleLinePrefix(s, 'quote')) }),
        button({ icon: 'symbol-namespace', title: 'Code block', onClick: run(fmt.toggleCodeBlock) }),
      ),
      h('span', { class: 'rmm-editor-spacer' }),
      h('span', { class: 'rmm-editor-hint', text: 'Esc to finish' }),
      button({
        icon: 'check',
        label: 'Done',
        title: 'Finish editing (Esc)',
        class: 'rmm-btn-primary',
        onClick: () => this.host.requestClose(this),
      }),
    );
  }

  private state(): fmt.TextState {
    return { value: this.textarea.value, start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
  }

  private apply(change: fmt.TextChange): void {
    const ta = this.textarea;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(change.from, change.to);
    // execCommand keeps the browser's undo stack intact; fall back if unavailable.
    const ok =
      change.insert === ''
        ? change.from === change.to || document.execCommand('delete')
        : document.execCommand('insertText', false, change.insert);
    if (!ok || ta.value.slice(change.from, change.from + change.insert.length) !== change.insert) {
      ta.setRangeText(change.insert, change.from, change.to, 'end');
    }
    ta.setSelectionRange(change.selStart, change.selEnd);
    this.onInput();
  }

  private onInput(): void {
    this.autosize();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), COMMIT_DELAY);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const mod = isMod(e);
    const key = e.key.toLowerCase();
    const handled = (fn?: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn?.();
    };

    if (e.key === 'Escape' || (mod && e.key === 'Enter')) {
      return handled(() => this.host.requestClose(this));
    }
    if (mod && key === 's') {
      return handled(() => {
        this.commit();
        this.host.save();
      });
    }
    if (mod && !e.shiftKey && key === 'b') {
      return handled(() => this.apply(fmt.toggleInline(this.state(), 'bold')));
    }
    if (mod && !e.shiftKey && key === 'i') {
      return handled(() => this.apply(fmt.toggleInline(this.state(), 'italic')));
    }
    if (mod && e.shiftKey && key === 'x') {
      return handled(() => this.apply(fmt.toggleInline(this.state(), 'strike')));
    }
    if (mod && key === 'k') {
      return handled(() => this.apply(fmt.insertLink(this.state())));
    }
    if (mod && (key === 'z' || key === 'y' || key === 'a')) {
      // Let the textarea handle undo/redo/select-all natively instead of VS Code.
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      return handled(() => this.apply(fmt.indentLines(this.state(), e.shiftKey)));
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && !e.isComposing) {
      const change = fmt.continueList(this.state());
      if (change) {
        return handled(() => this.apply(change));
      }
    }
  }

  private autosize(): void {
    const ta = this.textarea;
    const scrollY = window.scrollY;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
    window.scrollTo({ top: scrollY });
  }

  private ensureVisible(): void {
    const rect = this.el.getBoundingClientRect();
    if (rect.top < 60 || rect.top > window.innerHeight - 80) {
      window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: 'smooth' });
    }
  }
}

/** Best-effort mapping from a click in rendered text to an offset in the block's source. */
export function caretFromClick(blockEl: HTMLElement, event: MouseEvent | undefined, source: string): number {
  if (!event) {
    return source.length;
  }
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!range || !blockEl.contains(range.startContainer)) {
    return source.length;
  }
  const before = document.createRange();
  before.setStart(blockEl, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const renderedBefore = before.toString().replace(/\s+/g, ' ').trimStart();
  if (renderedBefore === '') {
    return 0;
  }
  const flat = source.replace(/\s+/g, ' ');
  // Look for the text just before the click, trying shorter snippets when
  // Markdown syntax (**, links, ...) breaks up longer ones.
  for (const len of [40, 20, 10, 5, 3, 2, 1]) {
    if (len > renderedBefore.length && len !== 1) {
      continue;
    }
    const needle = renderedBefore.slice(-Math.min(len, renderedBefore.length));
    const idx = flat.indexOf(needle);
    if (idx >= 0) {
      return mapFlatOffset(source, idx + needle.length);
    }
  }
  return source.length;
}

/** Convert an offset in the whitespace-collapsed string back to the original. */
function mapFlatOffset(source: string, flatOffset: number): number {
  let flat = 0;
  let i = 0;
  while (i < source.length && flat < flatOffset) {
    if (/\s/.test(source[i])) {
      while (i + 1 < source.length && /\s/.test(source[i + 1])) {
        i++;
      }
    }
    i++;
    flat++;
  }
  return i;
}
