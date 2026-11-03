import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { open, revert, until } from './helpers';

describe('editing through the stock client', () => {
  it('a removed import is a diagnostic from alder whose quick fix restores it', async () => {
    const editor = await open('blog/app/Posts/Index.alder');
    const doc = editor.document;
    try {
      const i = doc.getText().indexOf('import Layout\n');
      assert.ok(i >= 0);
      const edit = new vscode.WorkspaceEdit();
      edit.delete(doc.uri, new vscode.Range(doc.positionAt(i), doc.positionAt(i + 'import Layout\n'.length)));
      assert.ok(await vscode.workspace.applyEdit(edit));
      const diag = await until(() => vscode.languages.getDiagnostics(doc.uri)
        .find(d => d.source === 'alder' && d.message.includes('Layout')), 'a Layout diagnostic');
      const actions = await until(async () => {
        const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider', doc.uri, diag.range, vscode.CodeActionKind.QuickFix.value);
        return acts?.find(a => a.title.startsWith('Fix: ') && a.edit);
      }, 'the quick fix');
      assert.ok(await vscode.workspace.applyEdit(actions.edit!));
      assert.ok(doc.getText().includes('import Layout\n'));
      await until(() => !vscode.languages.getDiagnostics(doc.uri).some(d => d.source === 'alder' && d.message.includes('Layout')), 'the diagnostic to clear');
    } finally {
      await revert(doc);
    }
  });

  it('the server formats a mis-indented, mis-spaced line back to the original', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const original = doc.getText();
    const good = '  let found <- Post.bySlug params.slug\n';
    const bad = '      let found   <-   Post.bySlug params.slug\n';
    try {
      const i = original.indexOf(good);
      assert.ok(i >= 0);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(i), doc.positionAt(i + good.length)), bad);
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.notEqual(doc.getText(), original);
      const edits = await until(async () => {
        const e = await vscode.commands.executeCommand<vscode.TextEdit[]>(
          'vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 2, insertSpaces: true });
        return e && e.length > 0 ? e : undefined;
      }, 'formatting edits');
      const fix = new vscode.WorkspaceEdit();
      fix.set(doc.uri, edits);
      assert.ok(await vscode.workspace.applyEdit(fix));
      assert.equal(doc.getText(), original);
    } finally {
      await revert(doc);
    }
  });

  it('hover answers on a name', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const p = doc.positionAt(doc.getText().indexOf('Post.bySlug') + 'Post.'.length + 1);
    const hovers = await until(async () => {
      const h = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, p);
      return h && h.length > 0 ? h : undefined;
    }, 'a hover');
    assert.ok(hovers.length > 0);
  });
});
