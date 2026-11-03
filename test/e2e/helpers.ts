import * as vscode from 'vscode';
import { join, sep } from 'node:path';
import type { Api } from '../../src/extension';

export const ws = () => process.env.ALDER_E2E_WS!;
export const file = (rel: string) => vscode.Uri.file(join(ws(), rel));

export async function api(): Promise<Api> {
  const ext = vscode.extensions.getExtension<Api>('tapegram.alder');
  if (!ext) throw new Error('extension tapegram.alder is not loaded');
  return ext.activate();
}

// open shows a workspace file and waits until its root's client is running.
export async function open(rel: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(file(rel));
  const editor = await vscode.window.showTextDocument(doc);
  const a = await api();
  await until(async () => (await a.clients.ensure(doc)) !== undefined
    && a.clients.statuses().some(s => s.running && (doc.uri.fsPath === s.root || doc.uri.fsPath.startsWith(s.root + sep))), `client for ${rel}`);
  return editor;
}

// until polls f every 100 ms until it is truthy or the timeout passes.
export async function until<T>(f: () => Promise<T> | T, what: string, ms = 20_000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

// at is the position of the n-th (0-based) occurrence of needle in the document, plus offset.
export function at(doc: vscode.TextDocument, needle: string, n = 0, offset = 0): vscode.Position {
  let i = -1;
  for (let k = 0; k <= n; k++) {
    i = doc.getText().indexOf(needle, i + 1);
    if (i < 0) throw new Error(`no occurrence ${n} of ${JSON.stringify(needle)}`);
  }
  return doc.positionAt(i + offset);
}

export interface Tok { line: number; char: number; len: number; type: string; mods: string[] }

// decode turns the five-integer stream back into tokens with names.
export function decode(data: Uint32Array, legend: vscode.SemanticTokensLegend): Tok[] {
  const out: Tok[] = [];
  let line = 0, char = 0;
  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    const mods = legend.tokenModifiers.filter((_, b) => data[i + 4] & (1 << b));
    out.push({ line, char, len: data[i + 2], type: legend.tokenTypes[data[i + 3]], mods });
  }
  return out;
}

// revert drops a document's unsaved edits (the command works on the active editor).
export async function revert(doc: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.files.revert');
}
