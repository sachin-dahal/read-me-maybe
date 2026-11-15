import type { WebviewMessage } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export interface PersistedState {
  mode?: 'read' | 'edit';
  scrollTop?: number;
  outlineOpen?: boolean;
}

export function post(message: WebviewMessage): void {
  api.postMessage(message);
}

export function loadState(): PersistedState {
  return (api.getState() as PersistedState | undefined) ?? {};
}

export function saveState(patch: Partial<PersistedState>): void {
  api.setState({ ...loadState(), ...patch });
}
