import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';
import { FakeUi } from './fakeUi';
import { api, at, open, revert, until, ws } from './helpers';

// goodBuild waits until the server prefills generators at the cursor (`here`) from a good build:
// before one, new msg's page has no default from the cursor, so the page picker opens first.
async function goodBuild(editor: vscode.TextEditor): Promise<void> {
  const client = await (await api()).clients.forUri(editor.document.uri);
  assert.ok(client && client.state === State.Running);
  const p = editor.selection.active;
  await until(async () => ((await client.sendRequest<{ generators?: { here: boolean }[] }>('alder/generators', {
    textDocument: { uri: editor.document.uri.toString() }, position: { line: p.line, character: p.character },
  }))?.generators ?? []).some(g => g.here), 'generators from a good build');
}

describe('Generate: the flow', () => {
  it('new msg on a page: the starting-value field opens first, apply writes it unsaved and lands on the first hole', async () => {
    const editor = await open('gen/app/Posts/Index.alder');
    const doc = editor.document;
    const p = at(doc, 'load params');
    editor.selection = new vscode.Selection(p, p);
    await goodBuild(editor);
    const ui = new FakeUi();
    ui.onPick = rows => {
      const g = rows.flatMap(r => ('item' in r ? [r.item] : [])).find(x => x.id === 'new msg');
      assert.ok(g, JSON.stringify(rows));
      return g;
    };
    try {
      const running = vscode.commands.executeCommand('alder.generate', undefined, ui);
      const name = await until(() => ui.texts.find(t => t.title === 'new msg: name'), 'the name editor to open first');
      name.onChange('Delete');
      name.finish('Delete');
      const form = await until(() => (ui.openForm?.model.ready ? ui.openForm : undefined), 'a ready form');
      assert.equal(form.model.rows.find(r => r.name === 'name')?.value, 'Delete');
      const preview = vscode.workspace.textDocuments.find(d => d.uri.path.endsWith('Generate Preview.diff'));
      assert.ok(preview, 'no preview document');
      assert.ok(preview.getText().includes('Delete'), preview.getText());
      form.answer({ kind: 'apply' });
      await running;
      assert.ok(ui.log.includes('info alder: applied new msg: app/Posts/Index.alder (2 holes)'), ui.log.join('\n'));
      assert.ok(doc.isDirty && doc.getText().includes('Delete'));
      assert.ok(!readFileSync(join(ws(), 'gen/app/Posts/Index.alder'), 'utf8').includes('Delete'));
      const ed = vscode.window.activeTextEditor!;
      assert.ok(ed.document.lineAt(ed.selection.active.line).text.slice(ed.selection.active.character).startsWith('?delete'));
      await until(() => !vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label.includes('Generate Preview'))), 'the preview tab to close');
    } finally {
      await revert(doc);
    }
  });

  it('review then back shows the live preview again; the flow\'s end closes the plan diff', async () => {
    const editor = await open('gen/app/Posts/Index.alder');
    const p = at(editor.document, 'load params');
    editor.selection = new vscode.Selection(p, p);
    await goodBuild(editor);
    const isPreview = (u: vscode.Uri) => u.path.endsWith('Generate Preview.diff');
    const isPlan = (t: vscode.Tab) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.path.startsWith('/plan/');
    const tabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs);
    const ui = new FakeUi();
    ui.onPick = rows => rows.flatMap(r => ('item' in r ? [r.item] : [])).find(x => x.id === 'new msg');
    ui.onReview = async (m, o) => {
      o.onActive(m.files[0]);
      // the plan diff opens beside, in front of the preview
      await until(() => tabs().some(t => isPlan(t) && t.isActive), 'the plan diff in front');
      await until(() => !vscode.window.visibleTextEditors.some(e => isPreview(e.document.uri)), 'the diff to cover the preview');
      return 'back' as const;
    };
    const running = vscode.commands.executeCommand('alder.generate', undefined, ui);
    const name = await until(() => ui.texts.find(t => t.title === 'new msg: name'), 'the name editor');
    name.finish('Delete');
    const form = await until(() => (ui.openForm?.model.ready && !ui.openForm.model.updating ? ui.openForm : undefined), 'a ready form');
    form.answer({ kind: 'review' });
    await until(() => (ui.openForm && ui.openForm !== form ? ui.openForm : undefined), 'the form again after back');
    await until(() => vscode.window.visibleTextEditors.some(e => isPreview(e.document.uri)), 'the preview visible again');
    ui.openForm!.answer({ kind: 'escape' });
    await running;
    await until(() => !tabs().some(isPlan), 'the plan diff to close');
    await until(() => !tabs().some(t => t.label.includes('Generate Preview')), 'the preview tab to close');
  });

  it('a code action preset opens the form without the picker', async () => {
    const editor = await open('gen/app/Posts/Index.alder');
    const doc = editor.document;
    const p = at(doc, 'load params');
    const actions = await until(async () => {
      const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, new vscode.Range(p, p));
      return acts?.filter(a => a.command?.command === 'alder.generate').length ? acts : undefined;
    }, 'generator code actions');
    const action = actions.find(a => a.command?.command === 'alder.generate')!;
    const ui = new FakeUi();
    let picked = false;
    ui.onPick = () => { picked = true; return undefined; };
    const running = vscode.commands.executeCommand('alder.generate', ...(action.command!.arguments ?? []), ui);
    const form = await until(() => ui.openForm ?? ui.texts[0], 'the form or its first field');
    assert.ok(!picked);
    assert.ok(form);
    if (ui.texts[0]) ui.texts[0].finish(undefined);
    await until(() => ui.openForm, 'the form');
    ui.openForm!.answer({ kind: 'escape' });
    await running;
  });

  it('the real picker closes the flow on hide', async () => {
    await open('gen/app/Posts/Index.alder');
    let done = false;
    const running = Promise.resolve(vscode.commands.executeCommand('alder.generate')).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 1500));
    // still open: only the hide below can end it
    assert.ok(!done, 'the flow ended before the picker hid');
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await until(() => done, 'the flow to end after the picker hid', 5000);
    await running;
  });
});
