// Integration checks executed inside the VS Code extension host.
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'readMeMaybe.editor';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 15000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}

const activeTabInput = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;
const isOurs = (input, uri) =>
  input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE && input.uri.toString() === uri.toString();
const state = () => vscode.commands.executeCommand('readMeMaybe._test', 'state');
const sendFromWebview = (message) => vscode.commands.executeCommand('readMeMaybe._test', 'message', message);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (err) {
    results.push(`  ✗ ${name}\n    ${err && err.message}`);
    throw err;
  }
}

async function run() {
  const folder = vscode.workspace.workspaceFolders[0].uri;
  const sink = vscode.Uri.joinPath(folder, 'kitchen-sink.md');
  const scratch = vscode.Uri.joinPath(folder, 'scratch.md');
  const crlf = vscode.Uri.joinPath(folder, 'crlf.md');
  await vscode.workspace.fs.writeFile(scratch, Buffer.from('# Scratch\n\nFirst paragraph.\n\n- [ ] task\n'));
  await vscode.workspace.fs.writeFile(crlf, Buffer.from('# Windows\r\n\r\nLine one\r\n'));

  try {
    await check('opens .md files in ReadMeMaybe by default', async () => {
      await vscode.commands.executeCommand('vscode.open', sink);
      await waitFor(() => isOurs(activeTabInput(), sink), 'custom editor tab');
    });

    await check('webview boots under the real CSP and says hello', async () => {
      await waitFor(async () => (await state()).some((s) => s.uri === sink.toString() && s.ready), 'webview ready');
    });

    await check('edits from the webview land in the document', async () => {
      await vscode.commands.executeCommand('vscode.open', scratch);
      await waitFor(async () => (await state()).some((s) => s.uri === scratch.toString() && s.active), 'scratch active');
      await sendFromWebview({ type: 'edit', start: 2, end: 3, oldText: 'First paragraph.', newText: 'Edited **in place**.' });
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === scratch.toString());
      assert.equal(doc.getText(), '# Scratch\n\nEdited **in place**.\n\n- [ ] task\n');
      assert.equal(doc.isDirty, true);
    });

    await check('stale edits are rejected instead of corrupting the file', async () => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === scratch.toString());
      const before = doc.getText();
      await sendFromWebview({ type: 'edit', start: 2, end: 3, oldText: 'Something else entirely', newText: 'nope' });
      assert.equal(doc.getText(), before);
    });

    await check('undo goes through VS Code', async () => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === scratch.toString());
      await vscode.commands.executeCommand('undo');
      await waitFor(() => doc.getText().includes('First paragraph.'), 'undo applied');
    });

    await check('save from the webview writes to disk', async () => {
      await sendFromWebview({ type: 'edit', start: 4, end: 5, oldText: '- [ ] task', newText: '- [x] task' });
      await sendFromWebview({ type: 'save' });
      const disk = Buffer.from(await vscode.workspace.fs.readFile(scratch)).toString('utf8');
      assert.match(disk, /- \[x\] task/);
    });

    await check('CRLF files keep their line endings', async () => {
      await vscode.commands.executeCommand('vscode.open', crlf);
      await waitFor(async () => (await state()).some((s) => s.uri === crlf.toString() && s.active && s.ready), 'crlf ready');
      await sendFromWebview({ type: 'edit', start: 2, end: 3, oldText: 'Line one', newText: 'Line one\nLine two' });
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === crlf.toString());
      assert.equal(doc.getText(), '# Windows\r\n\r\nLine one\r\nLine two\r\n');
    });

    await check('"Open as Plain Text" swaps to the text editor in the same tab group', async () => {
      await vscode.commands.executeCommand('vscode.open', sink);
      await waitFor(async () => (await state()).some((s) => s.uri === sink.toString() && s.active), 'sink active');
      await vscode.commands.executeCommand('readMeMaybe.openAsText');
      await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === sink.toString(), 'text editor');
      const tabs = vscode.window.tabGroups.activeTabGroup.tabs;
      assert.equal(tabs.some((t) => isOurs(t.input, sink)), false, 'preview tab should be closed');
    });

    await check('"Open in ReadMeMaybe" swaps back', async () => {
      await vscode.commands.executeCommand('readMeMaybe.openPreview');
      await waitFor(() => isOurs(activeTabInput(), sink), 'custom editor again');
      const tabs = vscode.window.tabGroups.activeTabGroup.tabs;
      assert.equal(tabs.some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === sink.toString()), false);
    });

    await check('toolbar "Copy Markdown" puts the text on the clipboard', async () => {
      await sendFromWebviewSafe({ type: 'copy', text: '# Copied from the toolbar' });
      assert.equal(await vscode.env.clipboard.readText(), '# Copied from the toolbar');
    });

    await check('toolbar "Open as plain text" swaps to the text editor', async () => {
      await sendFromWebviewSafe({ type: 'openAsText' });
      await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === sink.toString(), 'text editor');
      await vscode.commands.executeCommand('readMeMaybe.openPreview');
      await waitFor(() => isOurs(activeTabInput(), sink), 'preview again');
    });

    await check('toolbar "Settings" opens the ReadMeMaybe settings', async () => {
      await waitFor(async () => (await state()).some((s) => s.uri === sink.toString() && s.active), 'sink active');
      await sendFromWebview({ type: 'openSettings' });
      await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.label === 'Settings', 'settings tab');
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    await check('auto-open can be turned off and on again', async () => {
      await vscode.commands.executeCommand('readMeMaybe.toggleAutoOpen');
      const assoc = vscode.workspace.getConfiguration('workbench').get('editorAssociations');
      assert.equal(assoc['*.md'], 'default');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.open', sink);
      await waitFor(() => activeTabInput() instanceof vscode.TabInputText, 'plain text when disabled');
      await vscode.commands.executeCommand('readMeMaybe.toggleAutoOpen');
      const restored = vscode.workspace.getConfiguration('workbench').get('editorAssociations');
      assert.equal(restored['*.md'], undefined);
    });

    await check('settings changes are accepted and validated', async () => {
      const cfg = vscode.workspace.getConfiguration('readMeMaybe');
      await sendFromWebviewSafe({ type: 'setConfig', key: 'theme', value: 'sepia' });
      assert.equal(vscode.workspace.getConfiguration('readMeMaybe').get('theme'), 'sepia');
      await sendFromWebviewSafe({ type: 'setConfig', key: 'theme', value: 'neon-disco' });
      assert.equal(vscode.workspace.getConfiguration('readMeMaybe').get('theme'), 'sepia');
      await cfg.update('theme', undefined, vscode.ConfigurationTarget.Global);
    });
  } finally {
    console.log(`\nReadMeMaybe integration tests\n${results.join('\n')}\n`);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
  }
}

async function sendFromWebviewSafe(message) {
  // Needs an active ReadMeMaybe editor to route through.
  const sink = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'kitchen-sink.md');
  if (!(await state()).some((s) => s.active)) {
    await vscode.commands.executeCommand('vscode.open', sink);
    await waitFor(async () => (await state()).some((s) => s.active), 'an active preview');
  }
  await sendFromWebview(message);
}

module.exports = { run };
