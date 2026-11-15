// Messages exchanged between the extension host and the webview.
// Text is always sent with "\n" line endings; the host converts back to the
// document's EOL when applying edits.

export type ThemeId = 'auto' | 'light' | 'dark' | 'sepia' | 'ocean';
export type FontFamilyId = 'sans' | 'serif';
export type ContentWidthId = 'narrow' | 'normal' | 'wide' | 'full';

export interface ViewConfig {
  theme: ThemeId;
  fontFamily: FontFamilyId;
  fontSize: number;
  contentWidth: ContentWidthId;
  startInEditMode: boolean;
}

export type ConfigKey = keyof ViewConfig;

export interface InitPayload {
  text: string;
  fileName: string;
  /** Webview URI of the folder containing the document (for relative images). */
  baseUri: string;
  /** Webview URI of the workspace root (for "/absolute" image paths), if any. */
  rootUri?: string;
  readOnly: boolean;
  config: ViewConfig;
  toolbarCollapsed: boolean;
  /** Heading slug to scroll to after the first render (from a link like other.md#setup). */
  fragment?: string;
}

export type HostCommand = 'find' | 'toggleEdit';

export type HostMessage =
  | ({ type: 'init' } & InitPayload)
  | { type: 'update'; text: string }
  | { type: 'config'; config: ViewConfig }
  | { type: 'command'; command: HostCommand }
  | { type: 'editRejected'; text: string };

/** Replace lines [start, end) whose current content is `oldText` with `newText`. */
export interface LineEdit {
  start: number;
  end: number;
  oldText: string;
  newText: string;
}

export type WebviewMessage =
  | { type: 'ready' }
  | ({ type: 'edit' } & LineEdit)
  | { type: 'save' }
  | { type: 'openLink'; href: string }
  | { type: 'copy'; text: string; toast?: string }
  | { type: 'setConfig'; key: ConfigKey; value: ViewConfig[ConfigKey] }
  | { type: 'setToolbarCollapsed'; collapsed: boolean }
  | { type: 'openAsText' }
  | { type: 'openSettings' };
