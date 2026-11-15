// Lazy Mermaid support: the (large) library is only loaded when a document
// actually contains a diagram, and diagrams are themed from our CSS tokens.

import { escapeHtml } from './util';

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, code: string): Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
}

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

const SOURCE_SELECTOR = '.rmm-mermaid-source';

export class MermaidRenderer {
  private loading: Promise<MermaidApi> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly cache = new Map<string, string>();
  private themeKey = '';
  private initializedKey = '';
  private themeVariables: Record<string, unknown> = {};
  private counter = 0;

  constructor(
    private readonly scriptSrc: string,
    private readonly nonce: string,
  ) {}

  /** Call whenever the reading theme changes; returns true if diagrams need a re-render. */
  setTheme(variables: Record<string, unknown>): boolean {
    const key = JSON.stringify(variables);
    if (key === this.themeKey) {
      return false;
    }
    this.themeKey = key;
    this.themeVariables = variables;
    return true;
  }

  enhance(root: ParentNode): void {
    root.querySelectorAll<HTMLElement>('.rmm-mermaid').forEach((el) => {
      if (el.dataset.code === undefined) {
        el.dataset.code = el.querySelector(SOURCE_SELECTOR)?.textContent ?? '';
      }
      if (el.dataset.state !== 'done' || el.dataset.theme !== this.themeKey) {
        this.schedule(el);
      }
    });
  }

  private schedule(el: HTMLElement): void {
    el.dataset.state = 'pending';
    this.queue = this.queue.then(() => this.renderOne(el)).catch(() => undefined);
  }

  private load(): Promise<MermaidApi> {
    this.loading ??= new Promise<MermaidApi>((resolve, reject) => {
      // Note: a heading like "## Mermaid" gets id="mermaid", which the browser
      // exposes as window.mermaid. Only trust the real library object.
      if (isMermaid(window.mermaid)) {
        resolve(window.mermaid);
        return;
      }
      const script = document.createElement('script');
      script.src = this.scriptSrc;
      script.nonce = this.nonce;
      script.onload = () =>
        isMermaid(window.mermaid) ? resolve(window.mermaid) : reject(new Error('Mermaid failed to load'));
      script.onerror = () => reject(new Error('Mermaid failed to load'));
      document.head.append(script);
    });
    return this.loading;
  }

  private async renderOne(el: HTMLElement): Promise<void> {
    if (!el.isConnected) {
      return;
    }
    const code = el.dataset.code ?? '';
    const themeKey = this.themeKey;
    const cacheKey = `${themeKey}\u0000${code}`;
    let svg = this.cache.get(cacheKey);

    if (!svg) {
      if (!el.querySelector('.rmm-mermaid-svg')) {
        el.classList.add('is-loading');
      }
      let mermaid: MermaidApi;
      try {
        mermaid = await this.load();
      } catch (error) {
        this.showError(el, code, error);
        return;
      }
      if (this.initializedKey !== themeKey) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: this.themeVariables,
          fontFamily: String(this.themeVariables.fontFamily ?? 'inherit'),
          flowchart: { curve: 'basis', htmlLabels: true, padding: 14 },
          sequence: { useMaxWidth: true },
        });
        this.initializedKey = themeKey;
      }
      const id = `rmm-mermaid-${++this.counter}`;
      try {
        svg = (await mermaid.render(id, code)).svg;
        this.cache.set(cacheKey, svg);
      } catch (error) {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        this.showError(el, code, error);
        return;
      }
    }
    if (!el.isConnected) {
      return;
    }
    el.classList.remove('is-loading', 'is-error');
    el.innerHTML =
      `<div class="rmm-mermaid-actions">` +
      `<button class="rmm-icon-btn" type="button" data-action="mermaid-zoom" title="View larger" aria-label="View larger"><i class="codicon codicon-screen-full"></i></button>` +
      `<button class="rmm-icon-btn" type="button" data-action="mermaid-copy" title="Copy diagram source" aria-label="Copy diagram source"><i class="codicon codicon-copy"></i></button>` +
      `</div><div class="rmm-mermaid-svg">${svg}</div>`;
    el.dataset.state = 'done';
    el.dataset.theme = themeKey;
  }

  private showError(el: HTMLElement, code: string, error: unknown): void {
    if (!el.isConnected) {
      return;
    }
    const message = (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 6).join('\n');
    el.classList.remove('is-loading');
    el.classList.add('is-error');
    el.innerHTML =
      `<div class="rmm-mermaid-error"><div class="rmm-mermaid-error-title"><i class="codicon codicon-warning"></i>` +
      `This diagram didn't make it. Mermaid says:</div><pre class="rmm-mermaid-error-msg">${escapeHtml(message)}</pre>` +
      `<pre class="rmm-mermaid-error-code">${escapeHtml(code)}</pre></div>`;
    el.dataset.state = 'done';
    el.dataset.theme = this.themeKey;
  }
}

function isMermaid(value: unknown): value is MermaidApi {
  return typeof (value as MermaidApi | undefined)?.render === 'function';
}

/** Read a CSS color token as hex so Mermaid's color math can work with it. */
export function cssColor(probe: HTMLElement, value: string): string {
  probe.style.color = '';
  probe.style.color = value;
  const computed = getComputedStyle(probe).color;
  let channels: number[] | undefined;
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(computed);
  if (rgb) {
    channels = [rgb[1], rgb[2], rgb[3]].map(Number);
  } else {
    // color-mix() resolves to "color(srgb r g b)" with 0..1 channels.
    const srgb = /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)/.exec(computed);
    if (srgb) {
      channels = [srgb[1], srgb[2], srgb[3]].map((n) => Number(n) * 255);
    }
  }
  if (!channels) {
    return '#888888';
  }
  return `#${channels
    .map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0'))
    .join('')}`;
}
