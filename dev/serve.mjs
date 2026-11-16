// Dev harness: serves the built webview in a normal browser with a fake VS Code
// host, so you can iterate on rendering and editing without reloading VS Code.
//
//   npm run dev                      -> http://localhost:5179
//   ?file=examples/another-file.md   -> pick a document
//   ?theme=sepia&mode=edit           -> start with a theme / mode
//   ?scheme=light                    -> simulate a light VS Code theme for "auto"
//
// The fake host acts out VS Code-only actions the closest way a browser can:
// copy uses the clipboard, "Open as plain text" opens the raw file in a new tab,
// links to other .md files navigate, and Settings shows a short explanation.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

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
  const fragment = query.get('fragment');
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
  const FILE = ${JSON.stringify(file)};
  const log = [];
  let noteTimer;
  const note = (message) => {
    let el = document.getElementById('dev-note');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dev-note';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99;max-width:380px;padding:9px 12px;border-radius:8px;' +
        'background:#1d1b26;color:#f4f2fb;font:12px/1.45 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.3)';
      document.body.append(el);
    }
    el.textContent = '[dev harness] ' + message;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => el.remove(), 5000);
  };
  const rawUrl = (path) => '/raw?file=' + encodeURIComponent(path);
  const openLink = (href) => {
    if (/^(https?|mailto):/i.test(href)) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    const [pathPart, hash = ''] = href.split('#');
    const target = decodeURIComponent(new URL(pathPart, 'http://x/' + FILE).pathname.slice(1));
    if (/\\.(md|markdown)$/i.test(target)) {
      const next = new URLSearchParams(location.search);
      next.set('file', target);
      hash ? next.set('fragment', hash) : next.delete('fragment');
      location.search = next.toString();
    } else {
      window.open(rawUrl(target), '_blank', 'noopener');
      note('In VS Code this opens ' + target + (hash ? ' at ' + hash : '') + ' in the editor.');
    }
  };
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
            fragment: ${JSON.stringify(fragment ?? undefined) ?? 'undefined'},
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
        case 'copy':
          // Runs inside the click, so the browser allows clipboard access.
          navigator.clipboard?.writeText(message.text).catch(() =>
            note('The browser blocked clipboard access. In VS Code this always works.'));
          break;
        case 'openAsText':
          window.open(rawUrl(FILE), '_blank', 'noopener');
          note('Opened the raw Markdown in a new tab. In VS Code this swaps to the text editor in the same tab.');
          break;
        case 'openSettings':
          note('In VS Code this opens Settings filtered to "readMeMaybe". Here, use the Aa panel or URL params like ?theme=sepia&font=serif&size=18&width=wide.');
          break;
        case 'openLink':
          openLink(message.href);
          break;
        case 'save':
          note('Edits here live in memory only. In VS Code, ⌘S writes the file.');
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

/** Resolve a repo-relative path, refusing anything outside the project or inside .git. */
function projectPath(rel) {
  const full = resolve(ROOT, normalize(rel));
  if (!full.startsWith(ROOT + sep) || full.split(sep).includes('.git')) {
    throw new Error(`Refusing to serve ${rel}`);
  }
  return full;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (url.pathname === '/') {
      const file = url.searchParams.get('file') ?? 'examples/kitchen-sink.md';
      const text = await readFile(projectPath(file), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(file, text, url.searchParams));
      return;
    }
    if (url.pathname === '/raw') {
      const text = await readFile(projectPath(url.searchParams.get('file') ?? ''), 'utf8');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
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
}).listen(PORT, '127.0.0.1', () => {
  console.log(`ReadMeMaybe dev harness: http://localhost:${PORT}`);
});
