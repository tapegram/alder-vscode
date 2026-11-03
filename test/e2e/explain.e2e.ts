import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { api, at, open, revert, until } from './helpers';

// serverText is the server's own explanation of code (requests go by method name: see client.e2e.ts).
async function serverText(uri: vscode.Uri, code: string): Promise<string> {
  const c: LanguageClient | undefined = await (await api()).clients.forUri(uri);
  assert.ok(c);
  return c.sendRequest<string>('workspace/executeCommand', { command: 'alder.explain', arguments: [code] });
}

describe('Alder: Explain Diagnostic', () => {
  it('explains the diagnostic under the cursor in a markdown document, as the server wrote it', async () => {
    const editor = await open('demo/app/Demo.alder');
    const doc = editor.document;
    try {
      const edit = new vscode.WorkspaceEdit();
      const p = at(doc, '40 + 1');
      edit.replace(doc.uri, new vscode.Range(p, p.translate(0, '40 + 1'.length)), '"x"');
      assert.ok(await vscode.workspace.applyEdit(edit));
      const diag = await until(() => vscode.languages.getDiagnostics(doc.uri).find(d => d.source === 'alder' && (typeof d.code === 'object' ? d.code.value : d.code) === 'E0003'), 'E0003');
      editor.selection = new vscode.Selection(diag.range.start.translate(0, 1), diag.range.start.translate(0, 1));
      const uri = await vscode.commands.executeCommand<vscode.Uri | undefined>('alder.explainDiagnostic');
      assert.ok(uri, 'nothing was shown');
      assert.equal(uri.path, '/explain/E0003.md');
      const shown = await vscode.workspace.openTextDocument(uri);
      assert.equal(shown.languageId, 'markdown');
      assert.equal(shown.getText(), await serverText(doc.uri, 'E0003'));
    } finally {
      await revert(doc);
    }
  });

  it('an explicit code is explained without a diagnostic; an unknown one shows nothing', async () => {
    await open('demo/app/Demo.alder');
    const uri = await vscode.commands.executeCommand<vscode.Uri | undefined>('alder.explainDiagnostic', 'E0003');
    assert.equal(uri?.path, '/explain/E0003.md');
    assert.equal(await vscode.commands.executeCommand('alder.explainDiagnostic', 'E9999'), undefined);
  });
});
