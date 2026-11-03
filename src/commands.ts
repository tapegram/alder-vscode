import * as vscode from 'vscode';
import { findRoot } from './root';

// NOT_YET are the commands later milestones fill in (5: the generator flow; 6: scratch). Each says so when run.
export const NOT_YET: Record<string, string> = {
  'alder.generate': 'Generate',
  'alder.test.run': 'Run Tests',
  'alder.test.runAtCursor': 'Run Test at Cursor',
  'alder.test.mutate': 'Mutation Testing',
  'alder.scratch.open': 'Open Scratch',
  'alder.scratch.send': 'Send to Scratch',
  'alder.scratch.openValue': 'Open Scratch Value',
};

export function registerNotYet(context: vscode.ExtensionContext): void {
  for (const [id, title] of Object.entries(NOT_YET)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, () =>
      vscode.window.showInformationMessage(`Alder: ${title} is not implemented yet`)));
  }
}

// trackProject keeps the alder.inProject context key: the active editor's file has an app root.
export function trackProject(context: vscode.ExtensionContext): void {
  const update = async (editor: vscode.TextEditor | undefined) => {
    const inProject = !!editor && editor.document.uri.scheme === 'file' && !!(await findRoot(editor.document.uri.fsPath));
    await vscode.commands.executeCommand('setContext', 'alder.inProject', inProject);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => void update(e)));
  void update(vscode.window.activeTextEditor);
}
