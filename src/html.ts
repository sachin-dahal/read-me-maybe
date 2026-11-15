import * as vscode from 'vscode';

export function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const asset = (...segments: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', ...segments)).toString();

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: http: data: blob:`,
    `media-src ${webview.cspSource} https: data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset('media', 'codicon.css')}">
  <link rel="stylesheet" href="${asset('webview.css')}">
  <title>ReadMeMaybe</title>
</head>
<body data-theme="auto" data-mermaid-src="${asset('media', 'mermaid.min.js')}">
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
}
