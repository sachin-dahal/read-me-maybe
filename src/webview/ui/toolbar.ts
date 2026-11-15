import type { ConfigKey, ContentWidthId, ThemeId, ViewConfig } from '../../shared/protocol';
import { button, h, icon, MOD } from './dom';
import { Popover } from './popover';

export type Mode = 'read' | 'edit';

export interface ToolbarActions {
  setMode(mode: Mode): void;
  toggleSearch(): void;
  toggleOutline(): void;
  setConfig(key: ConfigKey, value: ViewConfig[ConfigKey]): void;
  copyMarkdown(): void;
  openAsText(): void;
  openSettings(): void;
  setCollapsed(collapsed: boolean): void;
}

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'ocean', label: 'Ocean' },
];

const WIDTHS: { id: ContentWidthId; label: string }[] = [
  { id: 'narrow', label: 'Narrow' },
  { id: 'normal', label: 'Normal' },
  { id: 'wide', label: 'Wide' },
  { id: 'full', label: 'Full' },
];

export class Toolbar {
  readonly el: HTMLElement;
  readonly reveal: HTMLButtonElement;
  private readonly fileEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly badgeEl: HTMLElement;
  private readonly modeGroup: HTMLElement;
  private readonly readBtn: HTMLButtonElement;
  private readonly editBtn: HTMLButtonElement;
  private readonly searchBtn: HTMLButtonElement;
  private readonly outlineBtn: HTMLButtonElement;
  private readonly appearance: AppearancePanel;

  constructor(actions: ToolbarActions) {
    this.fileEl = h('span', { class: 'rmm-file' });
    this.statsEl = h('span', { class: 'rmm-stats' });
    this.badgeEl = h('span', { class: 'rmm-badge', text: 'Read-only', attrs: { hidden: '' } });

    this.readBtn = button({ icon: 'eye', label: 'Read', title: `Read mode (${MOD}E)`, onClick: () => actions.setMode('read') });
    this.editBtn = button({ icon: 'edit', label: 'Edit', title: `Edit mode (${MOD}E)`, onClick: () => actions.setMode('edit') });
    this.modeGroup = h('div', { class: 'rmm-segmented rmm-mode', attrs: { role: 'group', 'aria-label': 'Mode' } }, this.readBtn, this.editBtn);

    this.searchBtn = button({ icon: 'search', title: `Find (${MOD}F)`, onClick: () => actions.toggleSearch() });
    this.outlineBtn = button({ icon: 'list-tree', title: 'Outline', onClick: () => actions.toggleOutline() });

    this.appearance = new AppearancePanel(actions);
    const appearanceBtn = button({
      icon: 'text-size',
      title: 'Appearance: theme, font, size, width',
      onClick: () => this.appearance.popover.toggle(appearanceBtn),
    });

    const more = new Popover(
      h(
        'div',
        { class: 'rmm-menu', attrs: { role: 'menu' } },
        menuItem('copy', 'Copy Markdown', () => actions.copyMarkdown()),
        menuItem('go-to-file', 'Open as plain text', () => actions.openAsText()),
        h('div', { class: 'rmm-menu-sep' }),
        menuItem('settings-gear', 'ReadMeMaybe settings', () => actions.openSettings()),
      ),
      'rmm-popover-menu',
    );
    const moreBtn = button({ icon: 'ellipsis', title: 'More actions', onClick: () => more.toggle(moreBtn) });
    more.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.rmm-menu-item')) {
        more.close();
      }
    });

    this.el = h(
      'header',
      { class: 'rmm-toolbar' },
      h(
        'div',
        { class: 'rmm-toolbar-left' },
        h('span', { class: 'rmm-brand', title: 'ReadMeMaybe' }, icon('markdown')),
        this.fileEl,
        this.statsEl,
        this.badgeEl,
      ),
      h(
        'div',
        { class: 'rmm-toolbar-right' },
        this.modeGroup,
        h('span', { class: 'rmm-toolbar-sep' }),
        this.searchBtn,
        this.outlineBtn,
        appearanceBtn,
        moreBtn,
        button({ icon: 'chevron-up', title: 'Hide toolbar', class: 'rmm-collapse', onClick: () => actions.setCollapsed(true) }),
      ),
    );

    this.reveal = button({
      icon: 'chevron-down',
      title: 'Show toolbar',
      class: 'rmm-reveal',
      onClick: () => actions.setCollapsed(false),
    });
  }

  setFile(name: string, readOnly: boolean): void {
    this.fileEl.textContent = name;
    this.fileEl.title = name;
    this.badgeEl.hidden = !readOnly;
    this.modeGroup.hidden = readOnly;
  }

  setStats(words: number, minutes: number): void {
    this.statsEl.textContent = words === 0 ? '' : `${words.toLocaleString()} words · ${minutes} min read`;
  }

  setMode(mode: Mode): void {
    this.readBtn.classList.toggle('is-active', mode === 'read');
    this.editBtn.classList.toggle('is-active', mode === 'edit');
    this.readBtn.setAttribute('aria-pressed', String(mode === 'read'));
    this.editBtn.setAttribute('aria-pressed', String(mode === 'edit'));
  }

  setConfig(config: ViewConfig): void {
    this.appearance.update(config);
  }

  setSearchActive(active: boolean): void {
    this.searchBtn.classList.toggle('is-active', active);
  }

  setOutlineActive(active: boolean): void {
    this.outlineBtn.classList.toggle('is-active', active);
  }
}

function menuItem(iconName: string, label: string, onClick: () => void): HTMLElement {
  return h(
    'button',
    { class: 'rmm-menu-item', attrs: { type: 'button', role: 'menuitem' }, on: { click: onClick } },
    icon(iconName),
    h('span', { text: label }),
  );
}

class AppearancePanel {
  readonly popover: Popover;
  private readonly themeButtons: HTMLButtonElement[];
  private readonly fontButtons: HTMLButtonElement[];
  private readonly widthButtons: HTMLButtonElement[];
  private readonly sizeLabel: HTMLElement;
  private fontSize = 16;

  constructor(actions: ToolbarActions) {
    this.themeButtons = THEMES.map((theme) =>
      h(
        'button',
        {
          class: 'rmm-swatch-btn',
          title: `${theme.label} theme`,
          attrs: { type: 'button', 'aria-label': `${theme.label} theme` },
          data: { value: theme.id },
          on: { click: () => actions.setConfig('theme', theme.id) },
        },
        h('span', { class: 'rmm-swatch', data: { swatch: theme.id } }, h('span', { class: 'rmm-swatch-accent' })),
        h('span', { class: 'rmm-swatch-label', text: theme.label }),
      ),
    );

    this.fontButtons = (['sans', 'serif'] as const).map((font) =>
      h(
        'button',
        {
          class: `rmm-seg-btn rmm-font-${font}`,
          attrs: { type: 'button' },
          data: { value: font },
          on: { click: () => actions.setConfig('fontFamily', font) },
        },
        h('span', { class: 'rmm-font-sample', text: 'Aa' }),
        h('span', { text: font === 'sans' ? 'Sans' : 'Serif' }),
      ),
    );

    this.widthButtons = WIDTHS.map((width) =>
      h('button', {
        class: 'rmm-seg-btn',
        text: width.label,
        attrs: { type: 'button' },
        data: { value: width.id },
        on: { click: () => actions.setConfig('contentWidth', width.id) },
      }),
    );

    this.sizeLabel = h('span', { class: 'rmm-size-value' });
    const size = h(
      'div',
      { class: 'rmm-stepper' },
      button({ icon: 'remove', title: 'Smaller text', onClick: () => actions.setConfig('fontSize', Math.max(12, this.fontSize - 1)) }),
      this.sizeLabel,
      button({ icon: 'add', title: 'Larger text', onClick: () => actions.setConfig('fontSize', Math.min(26, this.fontSize + 1)) }),
    );

    const row = (label: string, control: HTMLElement) =>
      h('div', { class: 'rmm-pref-row' }, h('span', { class: 'rmm-pref-label', text: label }), control);

    this.popover = new Popover(
      h(
        'div',
        { class: 'rmm-prefs' },
        h('div', { class: 'rmm-pref-title', text: 'Theme' }),
        h('div', { class: 'rmm-swatches' }, ...this.themeButtons),
        row('Font', h('div', { class: 'rmm-segmented rmm-segmented-sm' }, ...this.fontButtons)),
        row('Size', size),
        row('Width', h('div', { class: 'rmm-segmented rmm-segmented-sm' }, ...this.widthButtons)),
      ),
      'rmm-popover-prefs',
    );
  }

  update(config: ViewConfig): void {
    this.fontSize = config.fontSize;
    this.sizeLabel.textContent = `${config.fontSize}px`;
    const mark = (buttons: HTMLButtonElement[], value: string) =>
      buttons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.value === value));
    mark(this.themeButtons, config.theme);
    mark(this.fontButtons, config.fontFamily);
    mark(this.widthButtons, config.contentWidth);
  }
}
