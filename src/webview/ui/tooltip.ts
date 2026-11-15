// Small themed tooltips for anything with a data-tooltip attribute. Faster and
// better looking than native title tooltips, and kept inside the window edges.

const SHOW_DELAY = 350;
const GAP = 8;

let tip: HTMLElement | undefined;
let current: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function installTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    const target = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tooltip]') ?? undefined;
    if (target === current) {
      return;
    }
    hide();
    if (target && target.dataset.tooltip) {
      current = target;
      timer = setTimeout(() => show(target), SHOW_DELAY);
    }
  });
  document.addEventListener('pointerout', (e) => {
    const next = e.relatedTarget as Node | null;
    if (current && next && current.contains(next)) {
      return;
    }
    hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('blur', hide);
}

function show(target: HTMLElement): void {
  if (!target.isConnected) {
    return;
  }
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'rmm-tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  tip.textContent = target.dataset.tooltip ?? '';
  tip.classList.remove('is-visible', 'is-above');
  tip.style.left = '0px';
  tip.style.top = '0px';

  const rect = target.getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const left = Math.min(window.innerWidth - width - GAP, Math.max(GAP, rect.left + rect.width / 2 - width / 2));
  const below = rect.bottom + GAP;
  const above = below + height > window.innerHeight - GAP;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(above ? rect.top - GAP - height : below)}px`;
  tip.classList.toggle('is-above', above);
  requestAnimationFrame(() => tip?.classList.add('is-visible'));
}

function hide(): void {
  clearTimeout(timer);
  current = undefined;
  tip?.classList.remove('is-visible');
}
