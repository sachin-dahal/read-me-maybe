import * as vscode from 'vscode';
import type { ConfigKey, ContentWidthId, FontFamilyId, ThemeId, ViewConfig } from './shared/protocol';

export const CONFIG_SECTION = 'readMeMaybe';

const THEMES: readonly ThemeId[] = ['auto', 'light', 'dark', 'sepia', 'ocean'];
const FONTS: readonly FontFamilyId[] = ['sans', 'serif'];
const WIDTHS: readonly ContentWidthId[] = ['narrow', 'normal', 'wide', 'full'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function readConfig(): ViewConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const fontSize = Number(cfg.get('fontSize', 16));
  return {
    theme: oneOf(cfg.get('theme'), THEMES, 'auto'),
    fontFamily: oneOf(cfg.get('fontFamily'), FONTS, 'sans'),
    fontSize: Number.isFinite(fontSize) ? Math.min(26, Math.max(12, Math.round(fontSize))) : 16,
    contentWidth: oneOf(cfg.get('contentWidth'), WIDTHS, 'normal'),
    startInEditMode: cfg.get('startInEditMode', false) === true,
  };
}

export async function writeConfig(key: ConfigKey, value: unknown): Promise<void> {
  const current = readConfig();
  const candidate = { ...current, [key]: value } as ViewConfig;
  // Round-trip through the same validation used when reading.
  const valid: Record<ConfigKey, boolean> = {
    theme: THEMES.includes(candidate.theme),
    fontFamily: FONTS.includes(candidate.fontFamily),
    fontSize: typeof candidate.fontSize === 'number' && candidate.fontSize >= 12 && candidate.fontSize <= 26,
    contentWidth: WIDTHS.includes(candidate.contentWidth),
    startInEditMode: typeof candidate.startInEditMode === 'boolean',
  };
  if (!valid[key]) {
    return;
  }
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(key, candidate[key], vscode.ConfigurationTarget.Global);
}
