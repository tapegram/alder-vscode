import * as vscode from 'vscode';
import { findRoot } from './root';

// trackProject keeps the alder.inProject context key: the active editor's file has an app root.
export function trackProject(context: vscode.ExtensionContext): void {
  const update = async (editor: vscode.TextEditor | undefined) => {
    const inProject = !!editor && editor.document.uri.scheme === 'file' && !!(await findRoot(editor.document.uri.fsPath));
    await vscode.commands.executeCommand('setContext', 'alder.inProject', inProject);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => void update(e)));
  void update(vscode.window.activeTextEditor);
}
