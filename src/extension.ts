import * as vscode from 'vscode';
import { ReadMeMaybeEditorProvider, VIEW_TYPE } from './editorProvider';

const MARKDOWN_GLOBS = ['*.md', '*.markdown'];

export function activate(context: vscode.ExtensionContext): void {
  const provider = ReadMeMaybeEditorProvider.register(context);

  const register = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register('readMeMaybe.find', () => provider.active?.command('find'));
  register('readMeMaybe.toggleEditMode', () => provider.active?.command('toggleEdit'));

  register('readMeMaybe.copyMarkdown', async () => {
    const session = provider.active;
    if (!session) {
      return;
    }
    await vscode.env.clipboard.writeText(session.document.getText());
    vscode.window.setStatusBarMessage('$(check) Markdown copied to clipboard', 2500);
  });

  register('readMeMaybe.openAsText', async () => {
    const session = provider.active;
    if (!session) {
      return;
    }
    const uri = session.document.uri;
    const viewColumn = session.panel.viewColumn;
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default', {
      viewColumn,
      preview: false,
    } satisfies vscode.TextDocumentShowOptions);
    await closeTabs(viewColumn, (input) =>
      input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE && sameUri(input.uri, uri),
    );
  });

  register('readMeMaybe.openPreview', async (arg?: vscode.Uri) => {
    const editor = vscode.window.activeTextEditor;
    const uri = arg instanceof vscode.Uri ? arg : editor?.document.uri;
    if (!uri) {
      void vscode.window.showInformationMessage('Open a Markdown file first, then try again.');
      return;
    }
    const viewColumn =
      editor && sameUri(editor.document.uri, uri) ? editor.viewColumn : vscode.window.tabGroups.activeTabGroup.viewColumn;
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, { viewColumn, preview: false });
    await closeTabs(viewColumn, (input) => input instanceof vscode.TabInputText && sameUri(input.uri, uri));
  });

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    register('readMeMaybe._test', (action: string, payload?: unknown) => provider.testHook(action, payload));
  }

  register('readMeMaybe.toggleAutoOpen', async () => {
    const workbench = vscode.workspace.getConfiguration('workbench');
    const current = { ...(workbench.inspect<Record<string, string>>('editorAssociations')?.globalValue ?? {}) };
    const disabled = MARKDOWN_GLOBS.every((glob) => current[glob] === 'default');
    for (const glob of MARKDOWN_GLOBS) {
      if (disabled) {
        delete current[glob];
      } else {
        current[glob] = 'default';
      }
    }
    await workbench.update('editorAssociations', current, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      disabled
        ? 'ReadMeMaybe will open Markdown files automatically again. Call me, maybe? 📞'
        : 'Auto-open is off. Markdown opens as plain text; use "Open in ReadMeMaybe" whenever you miss me.',
    );
  });
}

export function deactivate(): void {
  // Nothing to clean up: everything is registered on context.subscriptions.
}

function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
  return a.toString() === b.toString();
}

async function closeTabs(
  viewColumn: vscode.ViewColumn | undefined,
  match: (input: unknown) => boolean,
): Promise<void> {
  const group =
    vscode.window.tabGroups.all.find((g) => g.viewColumn === viewColumn) ?? vscode.window.tabGroups.activeTabGroup;
  const tabs = group.tabs.filter((tab) => match(tab.input));
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}
