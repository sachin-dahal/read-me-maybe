import { button, h } from './dom';

/** Full-window view of a diagram or image. Click anywhere or press Esc to close. */
export function openLightbox(source: Element): void {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.style.maxWidth = '';
  clone.classList.add('rmm-lightbox-content');

  const close = () => {
    overlay.classList.remove('is-open');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => overlay.remove(), 160);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const overlay = h(
    'div',
    { class: 'rmm-lightbox', attrs: { role: 'dialog', 'aria-modal': 'true' }, on: { click: close } },
    button({ icon: 'close', title: 'Close (Esc)', class: 'rmm-lightbox-close', onClick: close }),
    h('div', { class: 'rmm-lightbox-stage' }, clone),
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}
