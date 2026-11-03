import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RunOutcome } from '../../src/tests';
import { api, at, file, open, revert, until, ws } from './helpers';

const demo = () => join(ws(), 'demo');
const id = (...parts: string[]) => [demo(), ...parts].join('\0');

describe('the Test Explorer', () => {
  it('discovers each root\'s modules and tests at their lines', async () => {
    await open('demo/app/Demo.alder');
    const t = (await api()).tests;
    await t.discoverAll();
    const mod = t.item(id('Demo'));
    assert.ok(mod, 'no Demo module item');
    assert.equal(mod.label, 'Demo');
    assert.equal(t.item(id('Demo', 'answer is positive'))?.range?.start.line, 5);
    assert.equal(t.item(id('Demo', 'answer is 42'))?.range?.start.line, 7);
    assert.ok(t.item([join(ws(), 'blog'), 'Write', 'a taken slug is refused'].join('\0')), 'the blog\'s tests are missing');
  });

  it('Run Tests runs the root; the failure carries right as expected and left as actual', async () => {
    await open('demo/app/Demo.alder');
    const [o] = await vscode.commands.executeCommand<RunOutcome[]>('alder.test.run');
    assert.equal(o.kind, 'results', JSON.stringify(o));
    assert.match(o.summary ?? '', /^\d+ passed, 1 failed$/);
    const fail = o.results.find(r => r.id === id('Demo', 'answer is 42'));
    assert.deepEqual(fail && { ok: fail.ok, expected: fail.expected, actual: fail.actual }, { ok: false, expected: '42', actual: '41' });
    assert.ok(o.results.find(r => r.id === id('Demo', 'answer is positive'))?.ok);
  });

  it('Run Test at Cursor runs only the test above the cursor', async () => {
    const editor = await open('demo/app/Demo.alder');
    const p = at(editor.document, 'answer > 0');
    editor.selection = new vscode.Selection(p, p);
    const [o] = await vscode.commands.executeCommand<RunOutcome[]>('alder.test.runAtCursor');
    assert.equal(o.kind, 'results', JSON.stringify(o));
    assert.deepEqual(o.results.map(r => [r.id, r.ok]), [[id('Demo', 'answer is positive'), true]]);
  });

  it('an unsaved broken edit is saved first, and the run errors with "the app does not check"', async () => {
    const editor = await open('demo/app/Demo.alder');
    const doc = editor.document;
    const original = doc.getText();
    try {
      const edit = new vscode.WorkspaceEdit();
      const p = at(doc, '40 + 1');
      edit.replace(doc.uri, new vscode.Range(p, p.translate(0, '40 + 1'.length)), '"x"');
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(doc.isDirty);
      const [o] = await vscode.commands.executeCommand<RunOutcome[]>('alder.test.run');
      assert.equal(o.kind, 'compile', JSON.stringify(o));
      assert.equal(o.results.length, 0);
      assert.ok(!doc.isDirty, 'the document was not saved before the run');
    } finally {
      const restore = new vscode.WorkspaceEdit();
      restore.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original);
      await vscode.workspace.applyEdit(restore);
      await doc.save();
      await revert(doc);
    }
  });

  it('a second run of the same root cancels the first', async () => {
    await open('demo/app/Demo.alder');
    const t = (await api()).tests;
    const root = t.item(demo());
    assert.ok(root);
    const req = () => new vscode.TestRunRequest([root]);
    const first = t.execute(req(), 'test', new vscode.CancellationTokenSource().token);
    const second = t.execute(req(), 'test', new vscode.CancellationTokenSource().token);
    const [[a], [b]] = await Promise.all([first, second]);
    assert.equal(a.kind, 'cancelled', JSON.stringify(a));
    assert.equal(b.kind, 'results', JSON.stringify(b));
  });

  it('Cancel Test Run (the TestRun\'s own token) cancels a run started from a command', async () => {
    await open('demo/app/Demo.alder');
    const started = vscode.commands.executeCommand<RunOutcome[]>('alder.test.run');
    await new Promise(r => setTimeout(r, 300));
    await vscode.commands.executeCommand('testing.cancelRun');
    const [o] = await started;
    assert.equal(o.kind, 'cancelled', JSON.stringify(o));
  });

  it('a token cancelled before the run starts its work cancels it without spawning', async () => {
    await open('demo/app/Demo.alder');
    const t = (await api()).tests;
    const root = t.item(demo());
    assert.ok(root);
    const src = new vscode.CancellationTokenSource();
    src.cancel();
    const [o] = await t.execute(new vscode.TestRunRequest([root]), 'test', src.token);
    assert.equal(o.kind, 'cancelled', JSON.stringify(o));
    assert.equal(o.results.length, 0);
  });

  it('mutation testing a passing test puts the survivors in Problems', async function () {
    this.timeout(180_000);
    await open('demo/app/Demo.alder');
    const t = (await api()).tests;
    const item = t.item(id('Demo', 'answer is positive'));
    assert.ok(item);
    const [o] = await t.execute(new vscode.TestRunRequest([item]), 'mutate', new vscode.CancellationTokenSource().token);
    assert.equal(o.kind, 'results', JSON.stringify(o));
    assert.ok((o.survivors ?? 0) > 0, JSON.stringify(o));
    assert.match(o.title ?? '', /^alder test --mutate — \d+ killed, \d+ survived \(\d\.\d\d\)$/);
    const home = file('demo/app/Home.alder');
    const diags = await until(() => {
      const ds = t.survivorDiagnostics.get(home) ?? [];
      return ds.length > 0 ? ds : undefined;
    }, 'survivor diagnostics');
    assert.ok(diags.every(d => d.message.startsWith('survived  ') && d.severity === vscode.DiagnosticSeverity.Warning && d.source === 'alder mutate'));
  });
});
