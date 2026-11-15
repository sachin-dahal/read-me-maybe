import { h, icon } from './dom';

let toastEl: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, iconName = 'check'): void {
  if (!toastEl) {
    toastEl = h('div', { class: 'rmm-toast', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(toastEl);
  }
  toastEl.replaceChildren(icon(iconName), h('span', { text: message }));
  toastEl.classList.add('is-visible');
  clearTimeout(timer);
  timer = setTimeout(() => toastEl?.classList.remove('is-visible'), 2200);
}
