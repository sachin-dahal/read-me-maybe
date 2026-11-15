import { applyLineEdit, getLines, prepareAppend } from '../shared/lines';
import type { ConfigKey, HostMessage, InitPayload, LineEdit, ViewConfig } from '../shared/protocol';
import { loadState, post, saveState } from './host';
import { createMarkdown, renderMarkdown, type BlockKind, type RenderResult } from './render/markdown';
import { cssColor, MermaidRenderer } from './render/mermaid';
import { readingStats } from './render/stats';
import { BlockEditor, caretFromClick, type EditorHost } from './ui/blockEditor';
import { ContentView, type ContentHooks } from './ui/content';
import { button, closestBlock, h, isMod } from './ui/dom';
import { toggleTaskLine } from './ui/formatting';
import { openLightbox } from './ui/lightbox';
import { Outline } from './ui/outline';
import { Popover } from './ui/popover';
import { Search } from './ui/search';
import { toast } from './ui/toast';
import { Toolbar, type Mode, type ToolbarActions } from './ui/toolbar';

// Categorical colors for pie charts and other multi-series diagrams.
const PALETTE_LIGHT = ['#7c5cff', '#f0508f', '#1aa3b8', '#e98a00', '#2f9e44', '#e03131', '#4263eb', '#ae3ec9'];
const PALETTE_DARK = ['#a594ff', '#ff85bd', '#4fd1e3', '#ffc23d', '#6fdb84', '#ff8f8f', '#8ea2ff', '#e08cf5'];

const DEFAULT_CONFIG: ViewConfig = {
  theme: 'auto',
  fontFamily: 'sans',
  fontSize: 16,
  contentWidth: 'normal',
  startInEditMode: false,
};

class App implements ToolbarActions, ContentHooks, EditorHost {
  private source = '';
  private config: ViewConfig = DEFAULT_CONFIG;
  private mode: Mode = 'read';
  private readOnly = false;
  private initialized = false;
  private result: RenderResult = { blocks: [], headings: [] };
  private editor: BlockEditor | undefined;
  /** Element under the pointer when a click closed the editor (see onPointerDown). */
  private closingClickTarget: EventTarget | null = null;

  private readonly md = createMarkdown();
  private readonly mermaid: MermaidRenderer;
  private readonly toolbar: Toolbar;
  private readonly content: ContentView;
  private readonly search: Search;
  private readonly outline: Outline;
  private readonly empty: HTMLElement;
  private readonly addBlock: HTMLButtonElement;
  private readonly probe: HTMLElement;

  constructor(root: HTMLElement) {
    const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';
    this.mermaid = new MermaidRenderer(document.body.dataset.mermaidSrc ?? '', nonce);
    this.toolbar = new Toolbar(this);
    this.content = new ContentView(this, this.mermaid);
    this.search = new Search(this.content.el, (open) => this.toolbar.setSearchActive(open));
    this.outline = new Outline((open) => {
      this.toolbar.setOutlineActive(open);
      document.body.classList.toggle('has-outline', open);
      saveState({ outlineOpen: open });
    });
    this.empty = h(
      'div',
      { class: 'rmm-empty', attrs: { hidden: '' } },
      h('div', { class: 'rmm-empty-art', text: '📝' }),
      h('h2', { text: 'This file is empty… for now.' }),
      h('p', { text: "Hey, I just met you, and this is crazy, but here's a blank page, so write something, maybe?" }),
      button({ icon: 'edit', label: 'Start writing', title: 'Start writing', class: 'rmm-btn-primary', onClick: () => this.appendBlock() }),
    );
    this.addBlock = button({
      icon: 'add',
      label: 'Add a block',
      title: 'Add a new block at the end',
      class: 'rmm-add-block',
      onClick: () => this.appendBlock(),
    });
    this.probe = h('span', { class: 'rmm-probe', attrs: { 'aria-hidden': 'true' } });

    root.append(
      this.toolbar.el,
      this.toolbar.reveal,
      this.search.el,
      this.outline.el,
      h('main', { class: 'rmm-page' }, this.content.el, this.empty, this.addBlock),
      this.probe,
    );

    window.addEventListener('message', (e: MessageEvent<HostMessage>) => this.onMessage(e.data));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('mousedown', (e) => this.onPointerDown(e), true);
    document.addEventListener('click', (e) => this.onClickCapture(e), true);
    window.addEventListener('scroll', throttle(() => saveState({ scrollTop: window.scrollY }), 200), { passive: true });
    // VS Code swaps body classes (vscode-dark, vscode-light, ...) when the color theme changes.
    let vscodeClasses = '';
    new MutationObserver(() => {
      const next = Array.from(document.body.classList).filter((c) => c.startsWith('vscode-')).join(' ');
      if (next !== vscodeClasses) {
        vscodeClasses = next;
        this.applyTheme();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    post({ type: 'ready' });
  }

  // ---------------------------------------------------------------- messages

  private onMessage(message: HostMessage): void {
    switch (message.type) {
      case 'init':
        this.init(message);
        break;
      case 'update':
        if (message.text !== this.source) {
          this.applyExternal(message.text);
        }
        break;
      case 'editRejected':
        this.applyExternal(message.text);
        toast('The file changed elsewhere, so I refreshed it.', 'refresh');
        break;
      case 'config':
        this.applyConfig(message.config);
        break;
      case 'command':
        if (message.command === 'find') {
          this.search.show();
        } else if (message.command === 'toggleEdit') {
          this.setMode(this.mode === 'edit' ? 'read' : 'edit');
        }
        break;
    }
  }

  private init(payload: InitPayload): void {
    const state = loadState();
    const firstInit = !this.initialized;
    this.initialized = true;
    this.readOnly = payload.readOnly;
    this.content.resources = { base: payload.baseUri, root: payload.rootUri };
    this.toolbar.setFile(payload.fileName, payload.readOnly);
    this.applyConfig(payload.config);
    this.setCollapsed(payload.toolbarCollapsed, false);
    if (firstInit) {
      this.source = payload.text;
      this.render();
    } else {
      this.applyExternal(payload.text);
    }

    if (firstInit) {
      const initialMode = state.mode ?? (payload.config.startInEditMode ? 'edit' : 'read');
      this.setMode(this.readOnly ? 'read' : initialMode, false);
      if (state.outlineOpen) {
        this.outline.toggle(true);
      }
      requestAnimationFrame(() => {
        if (payload.fragment) {
          this.scrollToFragment(payload.fragment);
        } else if (state.scrollTop) {
          window.scrollTo({ top: state.scrollTop });
        }
      });
    }
  }

  /** The document changed outside this webview (undo, git, another editor, an agent...). */
  private applyExternal(text: string): void {
    const reopen = this.editor ? { start: this.editor.start, caret: this.editor.caret } : undefined;
    this.editor?.dispose();
    this.editor = undefined;
    this.source = text;
    this.render();
    if (reopen && this.mode === 'edit') {
      const block = Array.from(this.content.el.querySelectorAll<HTMLElement>('.rmm-block')).find(
        (el) => Number(el.dataset.start) === reopen.start,
      );
      if (block) {
        this.openEditor(block, undefined, reopen.caret);
      }
    }
  }

  // ---------------------------------------------------------------- rendering

  private render(): void {
    this.result = renderMarkdown(this.md, this.source);
    this.content.render(this.result.blocks);
    this.outline.setHeadings(this.result.headings);
    const stats = readingStats(this.source);
    this.toolbar.setStats(stats.words, stats.minutes);
    const isEmpty = this.source.trim() === '';
    this.empty.hidden = !isEmpty || this.editor !== undefined;
    this.search.refresh();
  }

  private applyConfig(config: ViewConfig): void {
    this.config = config;
    const body = document.body;
    body.dataset.theme = config.theme;
    body.dataset.font = config.fontFamily;
    body.dataset.width = config.contentWidth;
    body.style.setProperty('--rmm-font-size', `${config.fontSize}px`);
    this.toolbar.setConfig(config);
    this.applyTheme();
  }

  /** Resolve light/dark (for "auto" this follows VS Code) and re-theme diagrams. */
  private applyTheme(): void {
    const body = document.body;
    const theme = this.config.theme;
    const vscodeDark =
      body.classList.contains('vscode-dark') ||
      (body.classList.contains('vscode-high-contrast') && !body.classList.contains('vscode-high-contrast-light'));
    const scheme = theme === 'auto' ? (vscodeDark ? 'dark' : 'light') : theme === 'dark' || theme === 'ocean' ? 'dark' : 'light';
    if (body.dataset.scheme !== scheme) {
      body.dataset.scheme = scheme;
    }

    const color = (token: string) => cssColor(this.probe, `var(${token})`);
    const dark = scheme === 'dark';
    const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;
    const categorical: Record<string, string> = {};
    palette.forEach((value, i) => {
      categorical[`pie${i + 1}`] = value;
      categorical[`cScale${i}`] = value;
      categorical[`cScaleLabel${i}`] = dark ? '#15131f' : '#ffffff';
    });
    const changed = this.mermaid.setTheme({
      ...categorical,
      pieStrokeColor: color('--rmm-bg'),
      pieStrokeWidth: '2px',
      pieOuterStrokeColor: color('--rmm-border'),
      pieOuterStrokeWidth: '1px',
      pieOpacity: '1',
      pieTitleTextColor: color('--rmm-fg'),
      pieSectionTextColor: dark ? '#15131f' : '#ffffff',
      pieLegendTextColor: color('--rmm-fg'),
      darkMode: scheme === 'dark',
      background: color('--rmm-bg'),
      fontFamily: getComputedStyle(body).getPropertyValue('--rmm-font-sans').trim() || 'sans-serif',
      fontSize: '14px',
      primaryColor: color('--rmm-diagram-node'),
      primaryTextColor: color('--rmm-fg'),
      primaryBorderColor: color('--rmm-diagram-border'),
      secondaryColor: color('--rmm-diagram-alt'),
      secondaryTextColor: color('--rmm-fg'),
      secondaryBorderColor: color('--rmm-diagram-border'),
      tertiaryColor: color('--rmm-surface'),
      tertiaryTextColor: color('--rmm-fg'),
      tertiaryBorderColor: color('--rmm-border'),
      lineColor: color('--rmm-diagram-line'),
      textColor: color('--rmm-fg'),
      mainBkg: color('--rmm-diagram-node'),
      nodeBorder: color('--rmm-diagram-border'),
      clusterBkg: color('--rmm-surface'),
      clusterBorder: color('--rmm-border'),
      edgeLabelBackground: color('--rmm-bg'),
      noteBkgColor: color('--rmm-diagram-note'),
      noteTextColor: color('--rmm-fg'),
      noteBorderColor: color('--rmm-diagram-border'),
      actorBkg: color('--rmm-diagram-node'),
      actorBorder: color('--rmm-diagram-border'),
      actorTextColor: color('--rmm-fg'),
      signalColor: color('--rmm-fg'),
      signalTextColor: color('--rmm-fg'),
      labelBoxBkgColor: color('--rmm-diagram-node'),
      labelTextColor: color('--rmm-fg'),
      loopTextColor: color('--rmm-fg'),
    });
    if (changed) {
      this.content.refreshDiagrams();
    }
  }

  // ---------------------------------------------------------------- toolbar actions

  setMode(mode: Mode, announce = true): void {
    if (this.readOnly && mode === 'edit') {
      toast('This version is read-only.', 'lock');
      return;
    }
    if (mode === 'read') {
      this.closeEditor();
    }
    const changed = this.mode !== mode;
    this.mode = mode;
    document.body.dataset.mode = mode;
    this.toolbar.setMode(mode);
    saveState({ mode });
    if (changed && announce && mode === 'edit') {
      toast('Edit mode: click any block to edit it. Esc to finish.', 'edit');
    }
  }

  toggleSearch(): void {
    this.search.toggle();
  }

  toggleOutline(): void {
    this.outline.toggle();
  }

  setConfig(key: ConfigKey, value: ViewConfig[ConfigKey]): void {
    // Apply optimistically so the UI feels instant; the host echoes the saved value.
    this.applyConfig({ ...this.config, [key]: value });
    post({ type: 'setConfig', key, value });
  }

  copyMarkdown(): void {
    this.copy(this.source, 'Markdown copied');
  }

  openAsText(): void {
    this.editor?.commit();
    post({ type: 'openAsText' });
  }

  openSettings(): void {
    post({ type: 'openSettings' });
  }

  setCollapsed(collapsed: boolean, persist = true): void {
    document.body.classList.toggle('is-toolbar-collapsed', collapsed);
    if (persist) {
      post({ type: 'setToolbarCollapsed', collapsed });
    }
  }

  // ---------------------------------------------------------------- content hooks

  isEditMode(): boolean {
    return this.mode === 'edit';
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  editBlock(blockEl: HTMLElement, event: MouseEvent): void {
    this.openEditor(blockEl, event);
  }

  toggleTask(line: number): void {
    const oldText = getLines(this.source, line, line + 1);
    const newText = toggleTaskLine(oldText);
    if (newText === undefined) {
      return;
    }
    this.closeEditor();
    this.sendEdit({ start: line, end: line + 1, oldText, newText });
    this.render();
  }

  openLink(href: string): void {
    if (href.startsWith('#')) {
      this.scrollToFragment(href.slice(1));
      return;
    }
    post({ type: 'openLink', href });
  }

  copy(text: string, message: string): void {
    post({ type: 'copy', text });
    toast(message);
  }

  zoom(el: Element): void {
    openLightbox(el);
  }

  // ---------------------------------------------------------------- editor host

  sendEdit(edit: LineEdit): void {
    const next = applyLineEdit(this.source, edit);
    if (next === undefined) {
      // Our own view is out of sync; ask the host for the truth by re-requesting init.
      post({ type: 'ready' });
      return;
    }
    this.source = next;
    post({ type: 'edit', ...edit });
  }

  currentSource(): string {
    return this.source;
  }

  requestClose(): void {
    this.closeEditor();
  }

  save(): void {
    post({ type: 'save' });
  }

  // ---------------------------------------------------------------- editing

  private openEditor(blockEl: HTMLElement, event?: MouseEvent, caret?: number): void {
    if (this.readOnly) {
      return;
    }
    const start = Number(blockEl.dataset.start);
    const end = Number(blockEl.dataset.end);
    if (!(start >= 0) || !(end >= start)) {
      toast('Footnotes are generated. Edit their definitions in the source with “Open as plain text”.', 'info');
      return;
    }
    this.closeEditor();
    // closeEditor re-renders; make sure the block we were asked to edit survived.
    if (!blockEl.isConnected) {
      return;
    }
    const text = getLines(this.source, start, end);
    const kind = (blockEl.dataset.kind ?? 'other') as BlockKind;
    this.editor = new BlockEditor(this, blockEl, start, end, text, kind, caret ?? caretFromClick(blockEl, event, text));
  }

  private closeEditor(): void {
    const editor = this.editor;
    if (!editor) {
      return;
    }
    this.editor = undefined;
    editor.finish();
    this.render();
  }

  private appendBlock(): void {
    if (this.readOnly) {
      return;
    }
    this.setMode('edit', false);
    this.closeEditor();
    const { source: prepared, line } = prepareAppend(this.source);
    if (prepared !== this.source) {
      const lineTotal = this.source.split('\n').length;
      this.sendEdit({ start: 0, end: lineTotal, oldText: this.source, newText: prepared });
      this.render();
    }
    const blockEl = h('div', { class: 'rmm-block is-new', data: { start: String(line), end: String(line), kind: 'paragraph' } });
    this.content.el.append(blockEl);
    this.empty.hidden = true;
    this.editor = new BlockEditor(this, blockEl, line, line, '', 'paragraph', 0);
  }

  // ---------------------------------------------------------------- input

  private onPointerDown(e: MouseEvent): void {
    this.closingClickTarget = null;
    const editor = this.editor;
    const target = e.target as Element;
    if (
      !editor ||
      target === document.documentElement || // scrollbar
      editor.el.contains(target) ||
      target.closest('.rmm-toolbar, .rmm-popover, .rmm-search, .rmm-outline, .rmm-reveal, .rmm-toast')
    ) {
      return;
    }
    // Clicking outside the editor finishes it. Remember the target so the click
    // that follows doesn't land on a block that moved because of the re-render.
    this.closingClickTarget = target;
    this.closeEditor();
  }

  private onClickCapture(e: MouseEvent): void {
    const target = this.closingClickTarget;
    this.closingClickTarget = null;
    if (target && target instanceof Node && !target.isConnected) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (target && closestBlock(target) !== closestBlock(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const mod = isMod(e);
    const key = e.key.toLowerCase();
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && !e.shiftKey && !e.altKey && key === 'f') {
      handled();
      this.search.show();
    } else if (mod && !e.shiftKey && !e.altKey && key === 'e') {
      handled();
      this.setMode(this.mode === 'edit' ? 'read' : 'edit');
    } else if (mod && !e.shiftKey && key === 's') {
      handled();
      this.editor?.commit();
      this.save();
    } else if (e.key === 'Escape') {
      if (Popover.closeAll()) {
        handled();
      } else if (this.search.isOpen) {
        handled();
        this.search.close();
      } else if (this.outline.isOpen) {
        handled();
        this.outline.toggle(false);
      }
    }
  }

  private scrollToFragment(fragment: string): void {
    let id = fragment;
    try {
      id = decodeURIComponent(fragment);
    } catch {
      // keep raw fragment
    }
    const target =
      document.getElementById(id) ??
      document.getElementById(id.toLowerCase()) ??
      document.querySelector(`[name="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function throttle(fn: () => void, wait: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, wait);
  };
}

new App(document.getElementById('app')!);
