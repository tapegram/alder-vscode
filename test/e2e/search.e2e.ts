import * as assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { State, type LanguageClient } from 'vscode-languageclient/node';
import type { SearchSession, SearchUi } from '../../src/search';
import { searchLabel, type SearchItem, type SearchReply } from '../../src/searchItems';
import { api, at, open, revert, until, ws } from './helpers';

type Picked = { item: SearchItem; button?: 'definition' } | undefined;

// FakeSearch is the quick pick in a test: it records what the command shows; onPicked answers
// picked() (it may type first, with type()).
class FakeSearch implements SearchUi {
  inits: { value: string; placeholder: string; items: SearchItem[] }[] = [];
  shown: { items: SearchItem[]; note: string }[] = [];
  busy: boolean[] = [];
  private change: ((q: string) => void) | undefined;
  constructor(private onPicked: (f: FakeSearch) => Promise<Picked> | Picked = () => undefined) {}

  open(init: { value: string; placeholder: string; items: SearchItem[] }): SearchSession {
    this.inits.push(init);
    return {
      onChange: fn => { this.change = fn; },
      setItems: (items, note) => { this.shown.push({ items, note }); },
      setBusy: b => { this.busy.push(b); },
      picked: async () => this.onPicked(this),
    };
  }

  type(q: string): void {
    assert.ok(this.change, 'no change handler');
    this.change(q);
  }

  // last is the list showing now: the last setItems, else the opening items
  last(): SearchItem[] {
    return this.shown.length > 0 ? this.shown[this.shown.length - 1].items : this.inits[0]?.items ?? [];
  }

  // waitFor waits for a list whose labels satisfy ok
  waitFor(ok: (labels: string[]) => boolean, what: string): Promise<SearchItem[]> {
    return until(() => (ok(this.last().map(i => i.label)) ? this.last() : undefined), what);
  }
}

const blog = () => join(ws(), 'blog');

async function client(rel: string): Promise<LanguageClient> {
  const c = await (await api()).clients.forUri(vscode.Uri.file(join(ws(), rel)));
  assert.ok(c, `no client for ${rel}`);
  assert.equal(c.state, State.Running);
  return c;
}

// search runs Alder: Search with ui, the debounce off
async function search(ui: SearchUi, arg?: unknown): Promise<unknown> {
  const a = await api();
  a.search.ui = ui;
  a.search.debounceMs = 0;
  try {
    return await vscode.commands.executeCommand('alder.search', ...(arg === undefined ? [] : [arg]));
  } finally {
    a.search.ui = undefined;
    a.search.debounceMs = undefined;
  }
}

// appIndexed waits until the root's server searches the app (its first clean build)
async function appIndexed(rel: string, query: string): Promise<SearchReply> {
  const c = await client(rel);
  return until(async () => {
    const r = await c.sendRequest<SearchReply>('alder/search', { query });
    return r.results.some(x => x.source === 'app') ? r : undefined;
  }, `the server to index the app for ${query}`, 30_000);
}

async function holeReady(doc: vscode.TextDocument): Promise<void> {
  const c = await client('search/app/Hole.alder');
  await until(async () => {
    const r = await c.sendRequest<SearchReply>('alder/search', { query: '', uri: doc.uri.toString(), position: at(doc, '?h') });
    return r.query === ': List Text';
  }, 'the server to see the hole', 30_000);
}

describe('Alder: Search', () => {
  it('type query keeps the server\'s order', async () => {
    const ed = await open('blog/app/Posts/Index.alder');
    await appIndexed('blog/app/Posts/Index.alder', 'isAdmin');
    const want = await (await client('blog/app/Posts/Index.alder')).sendRequest<SearchReply>('alder/search', { query: ': List Text', uri: ed.document.uri.toString() });
    assert.ok(want.results.length > 1);
    const ui = new FakeSearch(async f => {
      f.type(': List Text');
      await f.waitFor(l => l.length > 0, 'results');
      return undefined;
    });
    await search(ui);
    const items = ui.last();
    assert.deepEqual(items.map(i => i.label), want.results.map(searchLabel));
    assert.ok(items.every(i => i.alwaysShow === true), 'every item is alwaysShow');
    assert.equal(ui.inits[0].value, '');
    assert.match(ui.inits[0].placeholder, /: List Text/);
    assert.equal(ed.document.isDirty, false);
  });

  it('pick on a hole fills it and puts the caret on the new hole', async () => {
    const ed = await open('search/app/Hole.alder');
    const doc = ed.document;
    try {
      await holeReady(doc);
      const p = at(doc, '?h');
      ed.selection = new vscode.Selection(p, p);
      const ui = new FakeSearch(async f => {
        const items = await f.waitFor(l => l.includes('Text.split'), 'Text.split');
        return { item: items.find(i => i.label === 'Text.split')! };
      });
      await search(ui);
      assert.equal(ui.inits[0].value, ': List Text');
      assert.ok(!doc.getText().includes('?h'), doc.getText());
      assert.match(doc.lineAt(4).text, /^ {2}Text\.split \?\w+ \?\w+$/);
      const active = vscode.window.activeTextEditor!;
      assert.equal(active.document.uri.toString(), doc.uri.toString());
      assert.ok(active.selection.isEmpty);
      assert.deepEqual([active.selection.active.line, active.selection.active.character], [4, '  Text.split '.length]);
    } finally {
      await revert(doc);
    }
  });

  it('pick off a hole inserts at the caret', async () => {
    const ed = await open('search/app/Hole.alder');
    const doc = ed.document;
    try {
      await holeReady(doc);
      const end = new vscode.Position(8, 0);
      ed.selection = new vscode.Selection(end, end);
      const ui = new FakeSearch(async f => {
        f.type('split');
        const items = await f.waitFor(l => l.includes('Text.split'), 'Text.split');
        return { item: items.find(i => i.label === 'Text.split')! };
      });
      await search(ui);
      assert.equal(ui.inits[0].value, '');
      assert.equal(doc.lineAt(8).text, 'Text.split');
      assert.ok(doc.getText().includes('?h'), 'the hole is untouched');
      const s = vscode.window.activeTextEditor!.selection;
      assert.deepEqual([s.active.line, s.active.character], [8, 'Text.split'.length]);
    } finally {
      await revert(doc);
    }
  });

  it('go to definition opens an app result', async () => {
    await open('blog/app/App.alder');
    await appIndexed('blog/app/App.alder', 'isAdmin');
    const ui = new FakeSearch(async f => {
      f.type('isAdmin');
      const items = await f.waitFor(l => l.includes('Admin.Layout.isAdmin'), 'Admin.Layout.isAdmin');
      const item = items.find(i => i.label === 'Admin.Layout.isAdmin')!;
      assert.equal(item.buttons?.length, 1);
      return { item, button: 'definition' };
    });
    await search(ui);
    const ed = vscode.window.activeTextEditor!;
    assert.equal(ed.document.uri.fsPath, join(blog(), 'app/Admin/Layout.alder'));
    assert.match(ed.document.lineAt(ed.selection.active.line).text, /isAdmin/);
    assert.equal(ed.document.isDirty, false);
  });

  it('stale replies are dropped', async () => {
    await open('blog/app/App.alder');
    await appIndexed('blog/app/App.alder', 'isAdmin');
    const a = await api();
    const real = await client('blog/app/App.alder');
    // the first `split` reply comes back late, after the newer query's
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let lateDone = false;
    const slow = Object.create(real) as LanguageClient;
    slow.sendRequest = (async (method: string, params: { query?: string }) => {
      const reply = await real.sendRequest(method, params);
      if (method === 'alder/search' && params.query === 'split') {
        await gate;
        lateDone = true;
      }
      return reply;
    }) as LanguageClient['sendRequest'];
    const forUri = a.clients.forUri;
    a.clients.forUri = async () => slow;
    try {
      const ui = new FakeSearch(async f => {
        f.type('split');
        f.type('isAdmin');
        await f.waitFor(l => l.includes('Admin.Layout.isAdmin'), 'the newer reply');
        release();
        await until(() => lateDone, 'the late reply');
        await new Promise(r => setTimeout(r, 200));
        return undefined;
      });
      await search(ui);
      assert.ok(ui.last().some(i => i.label === 'Admin.Layout.isAdmin'), JSON.stringify(ui.last().map(i => i.label)));
      assert.ok(!ui.shown.some(s => s.items.some(i => i.label === 'Text.split')), 'the stale split reply was shown');
    } finally {
      release();
      a.clients.forUri = forUri;
    }
  });

  it('old server message', async () => {
    await open('blog/app/App.alder');
    // a server with no alder/search, and a binary with no search command
    const dir = mkdtempSync(join(tmpdir(), 'alder-old-'));
    const bin = join(dir, 'alder');
    writeFileSync(bin, '#!/bin/sh\necho "usage: alder <command> [arguments]" >&2\nexit 2\n', { mode: 0o755 });
    const a = await api();
    const { binary, forUri } = a.clients;
    const old = { state: State.Running, sendRequest: async () => { throw Object.assign(new Error('Unhandled method alder/search'), { code: -32601 }); } };
    a.clients.binary = async () => bin;
    a.clients.forUri = async () => old as unknown as LanguageClient;
    try {
      const ui = new FakeSearch();
      await search(ui);
      const notes = ui.shown.map(s => s.note);
      assert.ok(notes.some(n => /update alder/.test(n)), JSON.stringify(notes));
    } finally {
      a.clients.binary = binary;
      a.clients.forUri = forUri;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('initialize declares experimental.alderSearch, and the code action command opens on the hole', async () => {
    const ed = await open('search/app/Hole.alder');
    const doc = ed.document;
    try {
      await holeReady(doc);
      // the caret is away from the hole: the action's position opens the picker
      const away = new vscode.Position(7, 0);
      ed.selection = new vscode.Selection(away, away);
      const p = at(doc, '?h', 0, 1);
      const action = await until(async () => {
        const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider', doc.uri, new vscode.Range(p, p));
        return acts?.find(x => x.title.startsWith('Search for'));
      }, 'the search action (offered only to a client declaring experimental.alderSearch)');
      assert.ok(action.command);
      assert.equal(action.command.command, 'alder.search');
      const ui = new FakeSearch();
      await search(ui, action.command.arguments?.[0]);
      assert.equal(ui.inits.length, 1);
      assert.equal(ui.inits[0].value, ': List Text');
      assert.ok(ui.inits[0].items.length > 0);
      // Esc: nothing changed, the caret where it was
      assert.equal(doc.isDirty, false);
      const s = vscode.window.activeTextEditor!.selection;
      assert.deepEqual([s.active.line, s.active.character], [7, 0]);
    } finally {
      await revert(doc);
    }
  });

  it('ctrl+enter apply is not bound while search is open', async () => {
    // the binding needs alder.formOpen, which search never sets
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
      contributes: { keybindings: { command: string; key: string; when: string }[] };
    };
    const apply = pkg.contributes.keybindings.find(k => k.command === 'alder.generate.apply');
    assert.ok(apply && /alder\.formOpen/.test(apply.when));
    // record the extension's setContext calls (it shares this vscode API object) around a real search
    const contexts: string[] = [];
    const cmds = vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand };
    const exec = cmds.executeCommand;
    cmds.executeCommand = (async (cmd: string, ...rest: unknown[]) => {
      if (cmd === 'setContext') contexts.push(String(rest[0]));
      return exec(cmd, ...rest);
    }) as typeof exec;
    try {
      await open('blog/app/App.alder');
      await open('blog/app/Posts/Index.alder');
      await until(() => contexts.includes('alder.inProject'), 'the extension\'s own setContext');
      const a = await api();
      a.search.debounceMs = 0;
      const running = exec('alder.search');
      await new Promise(r => setTimeout(r, 1000));
      await exec('workbench.action.closeQuickOpen');
      await running;
      a.search.debounceMs = undefined;
      assert.ok(!contexts.includes('alder.formOpen'), JSON.stringify(contexts));
    } finally {
      cmds.executeCommand = exec;
    }
  });
});
