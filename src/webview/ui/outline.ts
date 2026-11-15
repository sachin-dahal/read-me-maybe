import type { HeadingInfo } from '../render/plugins';
import { button, h } from './dom';

/** "On this page" drawer listing the document's headings. */
export class Outline {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private items: { id: string; el: HTMLElement }[] = [];
  private open = false;
  private raf = 0;

  constructor(private readonly onToggle: (open: boolean) => void) {
    this.list = h('nav', { class: 'rmm-outline-list', attrs: { 'aria-label': 'Document outline' } });
    this.el = h(
      'aside',
      { class: 'rmm-outline' },
      h(
        'div',
        { class: 'rmm-outline-header' },
        h('span', { text: 'On this page' }),
        button({ icon: 'close', title: 'Close outline', onClick: () => this.toggle(false) }),
      ),
      this.list,
    );
    window.addEventListener('scroll', () => {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.updateActive());
    }, { passive: true });
  }

  get isOpen(): boolean {
    return this.open;
  }

  setHeadings(headings: HeadingInfo[]): void {
    const visible = headings.filter((heading) => heading.level <= 4);
    const minLevel = Math.min(...visible.map((heading) => heading.level), 6);
    this.items = visible.map((heading) => {
      const el = h('a', {
        class: 'rmm-outline-item',
        text: heading.text || 'Untitled',
        title: heading.text,
        attrs: { href: `#${heading.id}` },
        data: { level: String(heading.level - minLevel) },
        on: {
          click: (e) => {
            e.preventDefault();
            document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
      });
      return { id: heading.id, el };
    });
    if (this.items.length === 0) {
      this.list.replaceChildren(h('p', { class: 'rmm-outline-empty', text: 'No headings yet. Add a # Title and it shows up here.' }));
    } else {
      this.list.replaceChildren(...this.items.map((item) => item.el));
    }
    this.updateActive();
  }

  toggle(force?: boolean): void {
    const next = force ?? !this.open;
    if (next === this.open) {
      return;
    }
    this.open = next;
    this.el.classList.toggle('is-open', next);
    this.onToggle(next);
    if (next) {
      this.updateActive();
    }
  }

  private updateActive(): void {
    if (!this.open || this.items.length === 0) {
      return;
    }
    let active = this.items[0];
    for (const item of this.items) {
      const target = document.getElementById(item.id);
      if (target && target.getBoundingClientRect().top <= 110) {
        active = item;
      } else if (target) {
        break;
      }
    }
    for (const item of this.items) {
      item.el.classList.toggle('is-active', item === active);
    }
  }
}
