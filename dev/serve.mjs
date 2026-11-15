// Dev harness: serves the built webview in a normal browser with a fake VS Code
// host, so you can iterate on rendering and editing without reloading VS Code.
//
//   npm run dev                      -> http://localhost:5179
//   ?file=examples/another-file.md   -> pick a document
//   ?theme=sepia&mode=edit           -> start with a theme / mode
//   ?scheme=light                    -> simulate a light VS Code theme for "auto"

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT ?? 5179);
const ALLOWED = ['dist', 'examples', 'media'];
const TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json',
};

const VSCODE_DARK = `
  --vscode-font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  --vscode-editor-background: #1f1f1f; --vscode-editor-foreground: #cccccc;
  --vscode-descriptionForeground: #9d9d9d; --vscode-button-background: #0078d4;
  --vscode-button-foreground: #ffffff; --vscode-textLink-foreground: #4daafc;
  --vscode-focusBorder: #0078d4; --vscode-editorWidget-background: #202020;
  --vscode-editor-selectionBackground: #264f78; --vscode-widget-shadow: rgba(0,0,0,.36);`;
const VSCODE_LIGHT = `
  --vscode-font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  --vscode-editor-background: #ffffff; --vscode-editor-foreground: #3b3b3b;
  --vscode-descriptionForeground: #717171; --vscode-button-background: #005fb8;
  --vscode-button-foreground: #ffffff; --vscode-textLink-foreground: #005fb8;
  --vscode-focusBorder: #005fb8; --vscode-editorWidget-background: #f8f8f8;
  --vscode-editor-selectionBackground: #add6ff; --vscode-widget-shadow: rgba(0,0,0,.16);`;

function page(file, text, query) {
  const nonce = 'devnonce';
  const scheme = query.get('scheme') === 'light' ? 'light' : 'dark';
  const csp = [
    "default-src 'none'",
    "img-src 'self' https: http: data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const config = {
    theme: query.get('theme') ?? 'auto',
    fontFamily: query.get('font') ?? 'sans',
    fontSize: Number(query.get('size') ?? 16),
    contentWidth: query.get('width') ?? 'normal',
    startInEditMode: query.get('mode') === 'edit',
  };
  const dir = file.split('/').slice(0, -1).join('/');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="/dist/media/codicon.css">
<link rel="stylesheet" href="/dist/webview.css">
<style>body { ${scheme === 'light' ? VSCODE_LIGHT : VSCODE_DARK} }</style>
<title>ReadMeMaybe dev</title>
</head>
<body class="vscode-${scheme}" data-theme="auto" data-mermaid-src="/dist/media/mermaid.min.js">
<div id="app"></div>
<script nonce="${nonce}">
(() => {
  let text = ${JSON.stringify(text).replace(/</g, '\\u003c')};
  let config = ${JSON.stringify(config)};
  const log = [];
  const send = (message) => window.postMessage(message, '*');
  const replaceLines = (source, start, end, next) => {
    const lines = source.split('\\n');
    const middle = next === '' ? [] : next.split('\\n');
    return [...lines.slice(0, start), ...middle, ...lines.slice(end)].join('\\n');
  };
  window.__host = {
    log,
    get text() { return text; },
    external(next) { text = next; send({ type: 'update', text }); },
    command(command) { send({ type: 'command', command }); },
  };
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      log.push(message);
      switch (message.type) {
        case 'ready':
          setTimeout(() => send({
            type: 'init', text, fileName: ${JSON.stringify(file.split('/').pop())},
            baseUri: location.origin + '/${dir}', rootUri: location.origin,
            readOnly: ${query.get('readonly') === '1'}, config, toolbarCollapsed: ${query.get('collapsed') === '1'},
          }));
          break;
        case 'edit': {
          const current = text.split('\\n').slice(message.start, message.end).join('\\n');
          if (current !== message.oldText) {
            console.warn('[host] rejected edit', message);
            send({ type: 'editRejected', text });
          } else {
            text = replaceLines(text, message.start, message.end, message.newText);
          }
          break;
        }
        case 'setConfig':
          config = { ...config, [message.key]: message.value };
          setTimeout(() => send({ type: 'config', config }), 30);
          break;
        default:
          console.log('[host]', message);
      }
    },
    getState() { try { return JSON.parse(sessionStorage.getItem('rmm-state')); } catch { return undefined; } },
    setState(state) { sessionStorage.setItem('rmm-state', JSON.stringify(state)); },
  });
})();
</script>
<script nonce="${nonce}" src="/dist/webview.js"></script>
</body></html>`;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (url.pathname === '/') {
      const file = url.searchParams.get('file') ?? 'examples/kitchen-sink.md';
      const text = await readFile(join(ROOT, normalize(file)), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(file, text, url.searchParams));
      return;
    }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (!ALLOWED.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) {
      res.writeHead(404).end();
      return;
    }
    const path = join(ROOT, rel);
    await stat(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`ReadMeMaybe dev harness: http://localhost:${PORT}`);
});
