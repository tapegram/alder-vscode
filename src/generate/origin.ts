import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { Clients } from '../client';
import { requireRoot } from '../project';
import { findRoot } from '../root';
import { entryFile } from './entry';
import type { Origin } from './flow';
import { within } from './within';

const WAIT_MS = 5000;

// findOrigin is the document and cursor every generator request carries, as
// project.with_alder_buf: the active editor when it is an alder file with a running client;
// else the root's entry file, opened without showing it (the client sends didOpen), waiting up
// to 5 s for its client.
export async function findOrigin(clients: Clients): Promise<{ origin: Origin; client: LanguageClient } | undefined> {
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.languageId === 'alder' && ed.document.uri.scheme === 'file') {
    const root = await findRoot(ed.document.uri.fsPath);
    const client = root ? await clients.ensure(ed.document) : undefined;
    if (root && client) {
      const a = ed.selection.active;
      return { origin: { uri: ed.document.uri.toString(), position: { line: a.line, character: a.character }, root }, client };
    }
  }
  const root = await requireRoot(clients);
  if (!root) return undefined;
  const file = await entryFile(root);
  if (!file) {
    void vscode.window.showWarningMessage('alder: no .alder file under app/');
    return undefined;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const client = await within(clients.ensure(doc), WAIT_MS);
  if (!client) {
    void vscode.window.showErrorMessage('alder: no alder lsp running for this file');
    return undefined;
  }
  return { origin: { uri: doc.uri.toString(), position: { line: 0, character: 0 }, root }, client };
}
