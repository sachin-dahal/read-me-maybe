import { h } from './dom';

/** A small anchored panel that closes on outside click or Escape. One at a time. */
export class Popover {
  private static current: Popover | undefined;
  readonly el: HTMLElement;
  private anchor: HTMLElement | undefined;

  constructor(content: HTMLElement, className = '') {
    this.el = h('div', { class: `rmm-popover ${className}`.trim(), attrs: { role: 'dialog' } }, content);
  }

  static closeAll(): boolean {
    if (Popover.current) {
      Popover.current.close();
      return true;
    }
    return false;
  }

  get isOpen(): boolean {
    return Popover.current === this;
  }

  toggle(anchor: HTMLElement): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(anchor);
    }
  }

  open(anchor: HTMLElement): void {
    Popover.current?.close();
    Popover.current = this;
    this.anchor = anchor;
    anchor.classList.add('is-active');
    document.body.append(this.el);
    this.position();
    requestAnimationFrame(() => this.el.classList.add('is-open'));
    document.addEventListener('mousedown', this.onOutside, true);
    window.addEventListener('resize', this.onResize);
  }

  close(): void {
    if (Popover.current === this) {
      Popover.current = undefined;
    }
    this.anchor?.classList.remove('is-active');
    this.el.classList.remove('is-open');
    this.el.remove();
    document.removeEventListener('mousedown', this.onOutside, true);
    window.removeEventListener('resize', this.onResize);
  }

  private position(): void {
    if (!this.anchor) {
      return;
    }
    const rect = this.anchor.getBoundingClientRect();
    const width = this.el.offsetWidth;
    const right = Math.max(8, window.innerWidth - rect.right);
    const left = Math.max(8, window.innerWidth - right - width);
    this.el.style.top = `${rect.bottom + 6}px`;
    this.el.style.left = `${left}px`;
  }

  private readonly onOutside = (event: MouseEvent) => {
    const target = event.target as Node;
    if (!this.el.contains(target) && !this.anchor?.contains(target)) {
      this.close();
    }
  };

  private readonly onResize = () => this.position();
}
