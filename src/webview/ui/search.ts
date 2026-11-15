import { button, h, icon, MOD } from './dom';

const SKIP = '.rmm-anchor, .rmm-code-header, .rmm-mermaid, .rmm-editor, script, style, svg';

/**
 * Find-in-page for the rendered document. Uses the CSS Custom Highlight API,
 * so matches are painted without touching the DOM (and work across inline
 * formatting like "hello **world**").
 */
export class Search {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly caseBtn: HTMLButtonElement;
  private ranges: Range[] = [];
  private index = -1;
  private caseSensitive = false;
  private open = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.input = h('input', {
      class: 'rmm-search-input',
      attrs: { type: 'text', placeholder: 'Find in document', 'aria-label': 'Find in document', spellcheck: 'false' },
    });
    this.count = h('span', { class: 'rmm-search-count', attrs: { 'aria-live': 'polite' } });
    this.caseBtn = button({ icon: 'case-sensitive', title: 'Match case', onClick: () => this.toggleCase() });
    this.el = h(
      'div',
      { class: 'rmm-search', attrs: { role: 'search' } },
      icon('search', 'rmm-search-icon'),
      this.input,
      this.count,
      this.caseBtn,
      button({ icon: 'arrow-up', title: 'Previous match (Shift+Enter)', onClick: () => this.go(-1) }),
      button({ icon: 'arrow-down', title: 'Next match (Enter)', onClick: () => this.go(1) }),
      button({ icon: 'close', title: 'Close (Esc)', onClick: () => this.close() }),
    );

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(false), 60);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.go(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        this.input.select();
      }
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    const selected = window.getSelection()?.toString().trim();
    if (selected && !selected.includes('\n') && selected.length < 120) {
      this.input.value = selected;
    }
    if (!this.open) {
      this.open = true;
      this.el.classList.add('is-open');
      this.onToggle(true);
    }
    this.input.focus();
    this.input.select();
    this.run(false);
  }

  close(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.el.classList.remove('is-open');
    this.clear();
    this.onToggle(false);
  }

  toggle(): void {
    if (this.open) {
      this.close();
    } else {
      this.show();
    }
  }

  /** Re-run after the document re-rendered. */
  refresh(): void {
    if (this.open) {
      this.run(true);
    }
  }

  private toggleCase(): void {
    this.caseSensitive = !this.caseSensitive;
    this.caseBtn.classList.toggle('is-active', this.caseSensitive);
    this.run(false);
    this.input.focus();
  }

  private clear(): void {
    this.ranges = [];
    this.index = -1;
    CSS.highlights?.delete('rmm-search');
    CSS.highlights?.delete('rmm-search-current');
    this.count.textContent = '';
  }

  private run(keepPosition: boolean): void {
    const query = this.input.value;
    const previous = this.index;
    this.clear();
    if (!query) {
      this.el.classList.remove('is-empty');
      return;
    }
    const needle = this.caseSensitive ? query : query.toLowerCase();

    for (const block of Array.from(this.root.querySelectorAll<HTMLElement>('.rmm-block:not(.is-editing)'))) {
      const nodes: Text[] = [];
      const starts: number[] = [];
      let text = '';
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Text);
        starts.push(text.length);
        text += (node as Text).data;
      }
      const haystack = this.caseSensitive ? text : text.toLowerCase();
      for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        const [startNode, startOffset] = locate(nodes, starts, at);
        const [endNode, endOffset] = locate(nodes, starts, at + needle.length);
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        this.ranges.push(range);
      }
    }

    this.el.classList.toggle('is-empty', this.ranges.length === 0);
    if (this.ranges.length === 0) {
      this.count.textContent = 'No results';
      return;
    }
    CSS.highlights?.set('rmm-search', new Highlight(...this.ranges));
    if (keepPosition && previous >= 0) {
      this.index = Math.min(previous, this.ranges.length - 1);
      this.paintCurrent(false);
    } else {
      // Start from the first match below the top of the viewport.
      const firstVisible = this.ranges.findIndex((r) => r.getBoundingClientRect().bottom > 56);
      this.index = firstVisible >= 0 ? firstVisible : 0;
      this.paintCurrent(true);
    }
  }

  private go(delta: number): void {
    if (this.ranges.length === 0) {
      this.run(false);
      return;
    }
    this.index = (this.index + delta + this.ranges.length) % this.ranges.length;
    this.paintCurrent(true);
  }

  private paintCurrent(scroll: boolean): void {
    const range = this.ranges[this.index];
    if (!range) {
      return;
    }
    CSS.highlights?.set('rmm-search-current', new Highlight(range));
    this.count.textContent = `${this.index + 1} of ${this.ranges.length}`;
    if (!scroll) {
      return;
    }
    let details = range.startContainer.parentElement?.closest('details');
    while (details) {
      details.open = true;
      details = details.parentElement?.closest('details');
    }
    const rect = range.getBoundingClientRect();
    if (rect.top < 90 || rect.bottom > window.innerHeight - 40) {
      window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: 'smooth' });
    }
  }
}

function locate(nodes: Text[], starts: number[], offset: number): [Text, number] {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  // Prefer the end of the previous node over the start of the next one.
  if (lo > 0 && starts[lo] === offset && offset > 0) {
    return [nodes[lo - 1], nodes[lo - 1].data.length];
  }
  return [nodes[lo], offset - starts[lo]];
}

export const SEARCH_SHORTCUT = `${MOD}F`;
