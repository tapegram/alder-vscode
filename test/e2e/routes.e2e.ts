import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RouteItem } from '../../src/routes';
import { State } from 'vscode-languageclient/node';
import { api, open, until, ws } from './helpers';

const blog = () => join(ws(), 'blog');

// serverRoutes polls the server: its list is empty until the first build that type-checked.
async function serverRoutes(root: string) {
  const a = await api();
  return until(async () => {
    const got = await a.routes.fetch(root);
    return 'routes' in got && got.routes.length > 0 ? got : undefined;
  }, 'the server to list routes');
}

describe('Alder: Routes', () => {
  it('lists the blog\'s routes from the server, GET / at Posts.Index.page', async () => {
    await open('blog/app/Posts/Index.alder');
    // the helper falls back to the CLI silently: ask the blog's server by method name
    const client = await (await api()).clients.forUri(vscode.Uri.file(blog()));
    assert.ok(client, 'no client for the blog');
    assert.equal(client.state, State.Running);
    const raw = await until(async () => {
      const r = await client.sendRequest<unknown[] | null>('alder/routes', {});
      return r && r.length > 0 ? r : undefined;
    }, 'the server to list routes');
    assert.ok(raw.length > 0);
    const got = await serverRoutes(blog());
    const home = got.routes.find(r => r.path === '/' && r.kind === 'page');
    assert.ok(home, JSON.stringify(got.routes.slice(0, 3)));
    assert.equal(`${home.module}.${home.name}`, 'Posts.Index.page');
    assert.ok(got.routes.some(r => r.kind === 'msg'), 'no msg routes');
  });

  it('the CLI lists the same routes', async () => {
    const a = await api();
    const lsp = await serverRoutes(blog());
    const cli = await a.routes.fetchCli(blog());
    assert.ok('routes' in lsp && 'routes' in cli, JSON.stringify(cli));
    const key = (r: { kind: string; path: string; module: string; name: string; file: string; line: number }) =>
      `${r.kind} ${r.path} ${r.module}.${r.name} ${r.file}:${r.line}`;
    assert.deepEqual(cli.routes.map(key).sort(), lsp.routes.map(key).sort());
  });

  it('when the server failed too, the CLI error says to update alder', async () => {
    // a root with no app/ makes `alder routes --json` fail; the server error is passed in
    const got = await (await api()).routes.fetchCli(ws(), 'Unhandled method alder/routes');
    assert.ok('error' in got);
    assert.match(got.error, /^this alder has no routes command \(Unhandled method alder\/routes\): update alder/);
  });

  it('picking a route opens its declaration', async () => {
    await open('blog/app/App.alder');
    const ui = { pick: async (items: RouteItem[]) => items.find(i => i.label === 'GET /') };
    const r = await vscode.commands.executeCommand<{ file: string; line: number } | undefined>('alder.routes', ui);
    assert.ok(r, 'nothing picked');
    const ed = vscode.window.activeTextEditor!;
    assert.equal(ed.document.uri.fsPath, join(blog(), 'app/Posts/Index.alder'));
    assert.equal(ed.selection.active.line, r.line);
    assert.match(ed.document.lineAt(r.line).text, /page/);
  });
});
