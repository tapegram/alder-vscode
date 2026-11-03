import * as vscode from 'vscode';
import type { Clients } from './client';
import { findRoot } from './root';

export const NO_ROOT = 'alder: no app here: open a file under a directory that holds app/';

// projectRoot is the app root a project command acts on, as project.lua's root: the active
// editor's file's root; else the only running server's; else the first workspace folder that is
// (or is inside) an app root.
export async function projectRoot(clients: Clients): Promise<string | undefined> {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc?.uri.scheme === 'file') {
    const r = await findRoot(doc.uri.fsPath);
    if (r) return r;
  }
  const running = clients.roots();
  if (running.length === 1) return running[0];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const r = await findRoot(f.uri.fsPath);
    if (r) return r;
  }
  return undefined;
}

// requireRoot is projectRoot, saying so when there is none.
export async function requireRoot(clients: Clients): Promise<string | undefined> {
  const r = await projectRoot(clients);
  if (!r) void vscode.window.showErrorMessage(NO_ROOT);
  return r;
}
