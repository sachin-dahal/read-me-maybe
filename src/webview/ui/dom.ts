type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  title?: string;
  text?: string;
  attrs?: Record<string, string>;
  data?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) {
    el.className = props.class;
  }
  if (props.title) {
    el.title = props.title;
  }
  if (props.text !== undefined) {
    el.textContent = props.text;
  }
  for (const [key, value] of Object.entries(props.attrs ?? {})) {
    el.setAttribute(key, value);
  }
  for (const [key, value] of Object.entries(props.data ?? {})) {
    el.dataset[key] = value;
  }
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    el.addEventListener(type, handler as EventListener);
  }
  for (const child of children) {
    if (child) {
      el.append(child);
    }
  }
  return el;
}

export function icon(name: string, extra = ''): HTMLElement {
  return h('i', { class: `codicon codicon-${name}${extra ? ` ${extra}` : ''}`, attrs: { 'aria-hidden': 'true' } });
}

export interface ButtonOptions {
  icon?: string;
  label?: string;
  title: string;
  class?: string;
  onClick: (event: MouseEvent) => void;
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const btn = h(
    'button',
    {
      class: `${options.label ? 'rmm-btn' : 'rmm-icon-btn'}${options.class ? ` ${options.class}` : ''}`,
      title: options.title,
      attrs: { type: 'button', 'aria-label': options.title },
      on: { click: options.onClick },
    },
    options.icon ? icon(options.icon) : null,
    options.label ? h('span', { text: options.label }) : null,
  );
  // Keep focus where it was (e.g. in the block editor) when clicking toolbar buttons.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  return btn;
}

export const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** Shortcut label prefix: "⌘" on macOS, "Ctrl+" elsewhere. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+';

export function isMod(event: KeyboardEvent | MouseEvent): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey;
}

export function closestBlock(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest('.rmm-block') as HTMLElement | null) : null;
}
