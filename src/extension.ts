import * as vscode from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- grows in later tasks
export interface Api {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used from the next task on
export function activate(_context: vscode.ExtensionContext): Api {
  return {};
}

export function deactivate(): void {}
