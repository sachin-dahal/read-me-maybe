import * as vscode from 'vscode';
import { readConfig, writeConfig } from './config';
import { getWebviewHtml } from './html';
import { resolveLink } from './links';
import { applyLineEdit, minimalDiff, normalizeEol } from './shared/lines';
import type { HostCommand, HostMessage, LineEdit, WebviewMessage } from './shared/protocol';

export const VIEW_TYPE = 'readMeMaybe.editor';
const TOOLBAR_COLLAPSED_KEY = 'readMeMaybe.toolbarCollapsed';

export class ReadMeMaybeEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Set<PreviewSession>();
  private activeSession: PreviewSession | undefined;
  /** Heading fragments to jump to once a linked document opens (keyed by URI). */
  readonly pendingFragments = new Map<string, string>();

  constructor(readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('readMeMaybe')) {
          const config = readConfig();
          this.broadcast({ type: 'config', config });
        }
      }),
    );
  }

  static register(context: vscode.ExtensionContext): ReadMeMaybeEditorProvider {
    const provider = new ReadMeMaybeEditorProvider(context);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
    );
    return provider;
  }

  get active(): PreviewSession | undefined {
    return this.activeSession;
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const docDir = vscode.Uri.joinPath(document.uri, '..');
    const roots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      docDir,
      ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
    ];
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    panel.webview.html = getWebviewHtml(panel.webview, this.context.extensionUri);

    const session = new PreviewSession(document, panel, this);
    this.sessions.add(session);
    if (panel.active) {
      this.activeSession = session;
    }
    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.activeSession = session;
      } else if (this.activeSession === session) {
        this.activeSession = undefined;
      }
    });
    panel.onDidDispose(() => {
      this.sessions.delete(session);
      if (this.activeSession === session) {
        this.activeSession = undefined;
      }
      session.dispose();
    });
  }

  get toolbarCollapsed(): boolean {
    return this.context.globalState.get<boolean>(TOOLBAR_COLLAPSED_KEY, false);
  }

  async setToolbarCollapsed(collapsed: boolean): Promise<void> {
    await this.context.globalState.update(TOOLBAR_COLLAPSED_KEY, collapsed);
  }

  private broadcast(message: HostMessage): void {
    for (const session of this.sessions) {
      session.post(message);
    }
  }
}

export class PreviewSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private editQueue: Promise<void> = Promise.resolve();
  private selfEditDepth = 0;
  private externalChangePending = false;
  private updateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
    private readonly provider: ReadMeMaybeEditorProvider,
  ) {
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document !== this.document || e.contentChanges.length === 0) {
          return;
        }
        if (this.selfEditDepth > 0) {
          return; // The webview already knows about edits it made itself.
        }
        this.externalChangePending = true;
        this.scheduleUpdate();
      }),
    );
  }

  post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  command(command: HostCommand): void {
    this.post({ type: 'command', command });
  }

  dispose(): void {
    clearTimeout(this.updateTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  private text(): string {
    return normalizeEol(this.document.getText());
  }

  private scheduleUpdate(): void {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      if (!this.externalChangePending) {
        return;
      }
      this.externalChangePending = false;
      this.post({ type: 'update', text: this.text() });
    }, 40);
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.sendInit();
        break;
      case 'edit':
        this.enqueueEdit(message);
        break;
      case 'save':
        await this.editQueue;
        await this.document.save();
        break;
      case 'openLink':
        await this.openLink(message.href);
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        break;
      case 'setConfig':
        await writeConfig(message.key, message.value);
        break;
      case 'setToolbarCollapsed':
        await this.provider.setToolbarCollapsed(message.collapsed);
        break;
      case 'openAsText':
        await vscode.commands.executeCommand('readMeMaybe.openAsText');
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'readMeMaybe');
        break;
    }
  }

  private sendInit(): void {
    const webview = this.panel.webview;
    const docDir = vscode.Uri.joinPath(this.document.uri, '..');
    const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
    const key = this.document.uri.toString();
    const fragment = this.provider.pendingFragments.get(key);
    this.provider.pendingFragments.delete(key);
    this.post({
      type: 'init',
      text: this.text(),
      fileName: this.document.uri.path.split('/').pop() ?? 'Untitled.md',
      baseUri: webview.asWebviewUri(docDir).toString(),
      rootUri: folder ? webview.asWebviewUri(folder.uri).toString() : undefined,
      readOnly: isReadOnly(this.document.uri),
      config: readConfig(),
      toolbarCollapsed: this.provider.toolbarCollapsed,
      fragment,
    });
  }

  private enqueueEdit(edit: LineEdit): void {
    this.editQueue = this.editQueue.then(() => this.applyEdit(edit)).catch((err) => {
      console.error('[ReadMeMaybe] edit failed', err);
    });
  }

  private async applyEdit(edit: LineEdit): Promise<void> {
    const current = this.text();
    const next = applyLineEdit(current, edit);
    if (next === undefined) {
      // The file changed underneath the webview (another editor, git, an agent...).
      this.post({ type: 'editRejected', text: current });
      return;
    }
    const original = this.document.getText();
    const target = this.document.eol === vscode.EndOfLine.CRLF ? next.replace(/\n/g, '\r\n') : next;
    const diff = minimalDiff(original, target);
    if (!diff) {
      return;
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(
      this.document.uri,
      new vscode.Range(this.document.positionAt(diff.start), this.document.positionAt(diff.end)),
      diff.text,
    );
    this.selfEditDepth++;
    try {
      const ok = await vscode.workspace.applyEdit(workspaceEdit);
      if (!ok) {
        this.post({ type: 'editRejected', text: this.text() });
        return;
      }
    } finally {
      this.selfEditDepth--;
    }
    if (this.text() !== next) {
      // Something else changed the document while our edit was in flight.
      this.externalChangePending = true;
      this.scheduleUpdate();
    }
  }

  private async openLink(href: string): Promise<void> {
    const target = resolveLink(href, this.document.uri);
    if (target === 'external') {
      await vscode.env.openExternal(vscode.Uri.parse(href.trim()));
      return;
    }
    if (!target) {
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(target.uri);
      if (stat.type & vscode.FileType.Directory) {
        await vscode.commands.executeCommand('revealInExplorer', target.uri);
        return;
      }
    } catch {
      void vscode.window.showWarningMessage(`ReadMeMaybe couldn't find ${vscode.workspace.asRelativePath(target.uri)}`);
      return;
    }
    if (target.fragment) {
      this.provider.pendingFragments.set(target.uri.toString(), target.fragment);
    }
    if (target.line !== undefined) {
      const position = new vscode.Position(target.line, 0);
      await vscode.commands.executeCommand('vscode.openWith', target.uri, 'default', {
        selection: new vscode.Range(position, position),
      } satisfies vscode.TextDocumentShowOptions);
      return;
    }
    await vscode.commands.executeCommand('vscode.open', target.uri);
  }
}

function isReadOnly(uri: vscode.Uri): boolean {
  if (uri.scheme === 'git' || uri.scheme === 'gitfs') {
    return true;
  }
  return vscode.workspace.fs.isWritableFileSystem(uri.scheme) === false;
}
