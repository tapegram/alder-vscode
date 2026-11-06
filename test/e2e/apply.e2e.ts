import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';
import type { Origin } from '../../src/generate/flow';
import { FakeUi } from './fakeUi';
import { api, at, open, revert, until, ws } from './helpers';

const gen = () => join(ws(), 'gen');

// originAt is the origin of a generator request at needle in rel (gen/<rel>), the editor open.
async function originAt(rel: string, needle?: string): Promise<{ origin: Origin; editor: vscode.TextEditor }> {
  const editor = await open(`gen/${rel}`);
  const position = needle ? at(editor.document, needle) : new vscode.Position(0, 0);
  editor.selection = new vscode.Selection(position, position);
  // the server prefills a generator's fields at the cursor (`here`) from its last good build:
  // wait for one. Every generator is always listed, so a non-empty list proves nothing.
  const client = await (await api()).clients.forUri(editor.document.uri);
  assert.ok(client && client.state === State.Running);
  await until(async () => ((await client.sendRequest<{ generators?: { here: boolean }[] }>('alder/generators', {
    textDocument: { uri: editor.document.uri.toString() }, position: { line: position.line, character: position.character },
  }))?.generators ?? []).some(g => g.here), 'generators from a good build');
  return { origin: { uri: editor.document.uri.toString(), position: { line: position.line, character: position.character }, root: gen() }, editor };
}

describe('Generate: apply', () => {
  it('new msg edits the open document unsaved, lands on the first hole, one undo restores it', async () => {
    const { origin, editor } = await originAt('app/Posts/Index.alder', 'load params');
    const doc = editor.document;
    const before = doc.getText();
    const ui = new FakeUi();
    try {
      assert.equal(await (await api()).generate.apply(origin, 'new msg', { name: 'Delete' }, ui), true, ui.log.join('\n'));
      assert.deepEqual(ui.log, ['info alder: applied new msg: app/Posts/Index.alder (2 holes)']);
      assert.ok(doc.getText().includes('Delete'));
      assert.ok(doc.isDirty);
      assert.ok(!readFileSync(join(gen(), 'app/Posts/Index.alder'), 'utf8').includes('Delete'), 'wrote to disk');
      const ed = vscode.window.activeTextEditor!;
      assert.equal(ed.document.uri.toString(), doc.uri.toString());
      const line = ed.document.lineAt(ed.selection.active.line).text;
      assert.equal(line.slice(ed.selection.active.character, ed.selection.active.character + '?delete'.length), '?delete', line);
      await vscode.commands.executeCommand('undo');
      assert.equal(doc.getText(), before, 'one undo does not restore the document');
    } finally {
      await revert(doc);
    }
  });

  it('new page creates an unsaved document for the module', async () => {
    const { origin } = await originAt('app/Posts/Index.alder');
    const ui = new FakeUi();
    const rel = 'app/Tags2/Index.alder';
    try {
      assert.equal(await (await api()).generate.apply(origin, 'new page', { module: 'Tags2.Index', path: '/tags2' }, ui), true, ui.log.join('\n'));
      assert.match(ui.log[0], /^info alder: applied new page: .*app\/Tags2\/Index\.alder/);
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === join(gen(), rel));
      assert.ok(doc, 'no document for the new page');
      assert.ok(doc.isDirty && doc.getText().includes('module Tags2.Index'));
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, join(gen(), rel));
    } finally {
      for (const d of vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.fsPath.startsWith(gen()))) await revert(d);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      rmSync(join(gen(), 'app/Tags2'), { recursive: true, force: true });
    }
  });

  it('a refusal is the server text, the alder generate collection stays empty (it carries no diagnostics), nothing changes', async () => {
    const { origin, editor } = await originAt('app/Posts/Index.alder');
    const before = editor.document.getText();
    const ui = new FakeUi();
    assert.equal(await (await api()).generate.apply(origin, 'new page', { module: 'Posts.Index', path: '/again' }, ui), false);
    assert.equal(ui.log.length, 1);
    assert.match(ui.log[0], /^error .*Posts\.Index/);
    assert.equal(editor.document.getText(), before);
    assert.ok(!editor.document.isDirty);
    // this refusal (the module exists) carries no plan.diagnostics, so the collection stays empty
    const left: string[] = [];
    (await api()).generate.diagnostics.forEach((u, ds) => left.push(`${u.toString()}: ${ds.map(d => d.message).join(' | ')}`));
    assert.deepEqual(left, []);
  });

  it('a clean document left open for a created file that is gone does not read as changed', async () => {
    const { origin } = await originAt('app/Posts/Index.alder');
    const rel = 'app/Tags3/Index.alder';
    const path = join(gen(), rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'module Tags3.Index\n');
    // plaintext: the client closes it on the server, which plans from the disk alone
    const stale = await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(vscode.Uri.file(path)), 'plaintext');
    rmSync(dirname(path), { recursive: true, force: true });
    assert.ok(vscode.workspace.textDocuments.includes(stale) && !stale.isDirty);
    const ui = new FakeUi();
    try {
      assert.equal(await (await api()).generate.apply(origin, 'new page', { module: 'Tags3.Index', path: '/tags3' }, ui), true, ui.log.join('\n'));
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === path);
      assert.ok(doc && doc.isDirty);
      assert.equal(doc.getText().split('module Tags3.Index').length, 2, doc.getText());
    } finally {
      for (const d of vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.fsPath.startsWith(gen()))) await revert(d);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      rmSync(dirname(path), { recursive: true, force: true });
    }
  });

  it('remove page re-checks the disk after the confirm: a file changed there, no editor open, aborts', async () => {
    const { origin } = await originAt('app/Posts/Index.alder');
    const path = join(gen(), 'app/Tags/Index.alder');
    const before = readFileSync(path, 'utf8');
    assert.ok(!vscode.workspace.textDocuments.some(d => d.uri.fsPath === path), 'a document is open for the file');
    const ui = new FakeUi();
    ui.onConfirm = () => {
      writeFileSync(path, `${before}-- changed on disk\n`);
      return true;
    };
    try {
      assert.equal(await (await api()).generate.apply(origin, 'remove page', { page: 'Tags.Index' }, ui), false);
      assert.equal(ui.log[1], 'error alder: app/Tags/Index.alder changed since planning; nothing applied');
      assert.ok(existsSync(path));
    } finally {
      writeFileSync(path, before);
    }
  });

  it('remove page asks; No applies nothing', async () => {
    const { origin } = await originAt('app/Tags/Index.alder');
    const ui = new FakeUi();
    ui.onConfirm = () => false;
    assert.equal(await (await api()).generate.apply(origin, 'remove page', { page: 'Tags.Index' }, ui), false);
    assert.deepEqual(ui.log, ['confirm Delete app/Tags/Index.alder? it goes to the trash; undo can restore it [Delete]']);
    assert.ok(existsSync(join(gen(), 'app/Tags/Index.alder')));
  });

  it('remove page re-checks after the confirm: an edit made meanwhile aborts', async () => {
    const { origin, editor } = await originAt('app/Tags/Index.alder');
    const ui = new FakeUi();
    ui.onConfirm = async () => {
      await editor.edit(b => b.insert(new vscode.Position(0, 0), '-- typed meanwhile\n'));
      return true;
    };
    try {
      assert.equal(await (await api()).generate.apply(origin, 'remove page', { page: 'Tags.Index' }, ui), false);
      assert.equal(ui.log[1], 'error alder: app/Tags/Index.alder changed since planning; nothing applied');
      assert.ok(existsSync(join(gen(), 'app/Tags/Index.alder')));
    } finally {
      await revert(editor.document);
    }
  });

  it('remove page with Delete removes the file', async () => {
    const { origin } = await originAt('app/Tags/Index.alder');
    const ui = new FakeUi();
    ui.onConfirm = () => true;
    try {
      assert.equal(await (await api()).generate.apply(origin, 'remove page', { page: 'Tags.Index' }, ui), true, ui.log.join('\n'));
      assert.match(ui.log[1], /^info alder: applied remove page: .*app\/Tags\/Index\.alder/);
      assert.ok(!existsSync(join(gen(), 'app/Tags/Index.alder')));
      assert.ok(!existsSync(join(gen(), 'app/Tags')), 'the empty page folder is left behind');
    } finally {
      for (const d of vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.fsPath.startsWith(gen()))) await revert(d);
    }
  });
});
