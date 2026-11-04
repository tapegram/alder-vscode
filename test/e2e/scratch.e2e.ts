import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { TEMPLATE } from '../../src/scratchText';
import { api, at, file, open, until } from './helpers';

const SCRATCH = 'pad/scratch.alder';
const disk = () => readFileSync(file(SCRATCH).fsPath, 'utf8');

// hints are the labels of the inlay hints of the document, as text.
async function hints(doc: vscode.TextDocument): Promise<string[]> {
  const range = new vscode.Range(0, 0, doc.lineCount, 0);
  const hs = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', doc.uri, range);
  return (hs ?? []).map(h => (typeof h.label === 'string' ? h.label : h.label.map(p => p.value).join('')));
}

describe('scratch files', function () {
  // the first run of a scratch file builds a program
  this.timeout(300_000);

  it('Open Scratch creates the template and its watch gets an inlay hint', async () => {
    await open('pad/app/Pad.alder');
    assert.equal(existsSync(file(SCRATCH).fsPath), false);
    await vscode.commands.executeCommand('alder.scratch.open');
    assert.equal(disk(), TEMPLATE);
    const doc = vscode.window.activeTextEditor!.document;
    assert.equal(doc.uri.fsPath, file(SCRATCH).fsPath);
    await until(async () => (await hints(doc)).includes('⇒ 2 : Int'), 'the hint ⇒ 2 : Int', 240_000);
  });

  it('Send to Scratch sends the current line as a watch and saves', async () => {
    const editor = await open('pad/app/Pad.alder');
    const p = at(editor.document, '20 + 22');
    editor.selection = new vscode.Selection(p, p);
    assert.equal(await vscode.commands.executeCommand('alder.scratch.send'), true);
    assert.ok(disk().endsWith('\n> 1 + 1\n\n> 20 + 22\n'), disk());
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file(SCRATCH).fsPath)!;
    assert.equal(doc.isDirty, false);
    // the send leaves the focus where it was and shows the scratch file beside
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file('pad/app/Pad.alder').fsPath);
    assert.ok(vscode.window.visibleTextEditors.some(e => e.document === doc));
    await until(async () => (await hints(doc)).includes('⇒ 42 : Int'), 'the hint ⇒ 42 : Int', 240_000);
  });

  it('a selection of watches in the scratch file goes in raw', async () => {
    const editor = await open(SCRATCH);
    const p = at(editor.document, '> 20 + 22');
    editor.selection = new vscode.Selection(p, p.translate(0, 3));
    assert.equal(await vscode.commands.executeCommand('alder.scratch.send'), true);
    assert.ok(disk().endsWith('\n> 20 + 22\n\n> 20 + 22\n'), disk());
  });

  it('send keeps unsaved edits in the scratch document', async () => {
    const scratch = await open(SCRATCH);
    const doc = scratch.document;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(doc.lineCount - 1, 0), '-- mine\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.equal(doc.isDirty, true);
    const editor = await open('pad/app/Pad.alder');
    const p = at(editor.document, 'answer : Int');
    // a selection from the signature to the line after the body: the signature, the head and
    // the body go in (that line is blank and trimmed; the unit tests of lineSpan cover column 0)
    editor.selection = new vscode.Selection(p, new vscode.Position(p.line + 3, 0));
    assert.equal(await vscode.commands.executeCommand('alder.scratch.send'), true);
    assert.ok(disk().includes('-- mine\n'), disk());
    assert.ok(disk().endsWith('-- mine\n\nanswer : Int\nanswer =\n    20 + 22\n'), disk());
    assert.equal(doc.isDirty, false);
  });

  it('Open Scratch Value opens the watch under the cursor beside', async () => {
    const editor = await open(SCRATCH);
    const doc = editor.document;
    await until(async () => (await hints(doc)).includes('⇒ 2 : Int'), 'the hint ⇒ 2 : Int', 240_000);
    const p = at(doc, '> 1 + 1');
    editor.selection = new vscode.Selection(p, p);
    const value = await vscode.commands.executeCommand<vscode.TextDocument>('alder.scratch.openValue');
    assert.ok(value);
    assert.equal(value.getText(), '2\n: Int');
    // the comment line holds no watch
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    assert.equal(await vscode.commands.executeCommand('alder.scratch.openValue'), undefined);
  });

  it('a watch whose hint leaves its note out has a hover', async () => {
    const editor = await open(SCRATCH);
    const doc = editor.document;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.lineAt(doc.lineCount - 1).range.end, '\n> Task.succeed 1\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await doc.save());
    const p = at(doc, '> Task.succeed 1');
    const text = await until(async () => {
      const hs = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, p.translate(0, 2));
      const all = (hs ?? []).flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value))).join('\n');
      return all.includes('not run: scratch evaluates pure values only') ? all : undefined;
    }, 'the effect note in a hover', 240_000);
    assert.ok(text.includes('```'), text);
    // a one-line value the hint shows whole has no hover of ours
    const q = at(doc, '> 1 + 1');
    const hs = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, q.translate(0, 2));
    const ours = (hs ?? []).flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value))).filter(s => s.includes('```text'));
    assert.deepEqual(ours, []);
  });

  it('a file-level note shows on line 1 and dims when the document changes', async () => {
    const a = await api();
    const editor = await open(SCRATCH);
    const doc = editor.document;
    const all = new vscode.Range(0, 0, doc.lineCount, 0);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, all, '-- nothing to watch\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await doc.save());
    const uri = doc.uri.toString();
    const shown = await until(() => a.scratch.line(uri), 'the file-level note', 240_000);
    assert.deepEqual(shown, { text: 'the file has no watches; add a line `> expr`', kind: 'note', stale: false });
    const typing = new vscode.WorkspaceEdit();
    typing.insert(doc.uri, new vscode.Position(1, 0), 'x');
    assert.ok(await vscode.workspace.applyEdit(typing));
    assert.equal(a.scratch.line(uri)?.stale, true);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });
});
