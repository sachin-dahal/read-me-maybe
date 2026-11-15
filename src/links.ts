import * as vscode from 'vscode';

const EXTERNAL = /^(https?|mailto|vscode|vscode-insiders|antigravity):/i;

export interface LinkTarget {
  uri: vscode.Uri;
  fragment?: string;
  line?: number;
}

/** Resolve an href found in a Markdown document to something we can open. */
export function resolveLink(href: string, document: vscode.Uri): LinkTarget | 'external' | undefined {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }
  if (EXTERNAL.test(trimmed)) {
    return 'external';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^file:/i.test(trimmed)) {
    // Unknown schemes (javascript:, command:, ...) are ignored on purpose.
    return undefined;
  }

  const hashIndex = trimmed.indexOf('#');
  const rawPath = (hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed).split('?')[0];
  const fragment = hashIndex >= 0 ? decodeSafe(trimmed.slice(hashIndex + 1)) : undefined;

  let uri: vscode.Uri;
  if (/^file:/i.test(rawPath)) {
    uri = vscode.Uri.parse(rawPath);
  } else {
    const path = decodeSafe(rawPath);
    if (path.startsWith('/')) {
      const folder = vscode.workspace.getWorkspaceFolder(document);
      uri = folder ? vscode.Uri.joinPath(folder.uri, path) : document.with({ path });
    } else {
      uri = vscode.Uri.joinPath(vscode.Uri.joinPath(document, '..'), path);
    }
  }

  const lineMatch = fragment?.match(/^L(\d+)/i);
  return {
    uri,
    fragment: lineMatch ? undefined : fragment,
    line: lineMatch ? Math.max(0, Number(lineMatch[1]) - 1) : undefined,
  };
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
