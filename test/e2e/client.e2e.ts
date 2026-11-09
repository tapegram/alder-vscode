import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, at, decode, file, open, until } from './helpers';
// types only: the request objects of the test's own vscode-languageclient are not the bundled
// client's (its parameter-structure check rejects them), so requests go by method name
import type { FoldingRange, LanguageClient, SelectionRange } from 'vscode-languageclient/node';
import { TOKEN_TYPES, TOKEN_MODIFIERS } from '../../src/legend';

// serverOf is the stock client of the root that holds uri.
async function serverOf(uri: vscode.Uri): Promise<LanguageClient> {
  const c = await (await api()).clients.forUri(uri);
  assert.ok(c, `no client for ${uri.fsPath}`);
  return c;
}

describe('the client', () => {
  it('starts one client for the blog with tokens, folding, selection and scratch', async () => {
    await open('blog/app/Posts/Show.alder');
    const a = await api();
    const st = a.clients.statuses().find(s => s.root.endsWith('/blog'));
    assert.ok(st, JSON.stringify(a.clients.statuses()));
    assert.deepEqual({ running: st.running, tokens: st.tokens, scratch: st.scratch }, { running: true, tokens: true, scratch: true });
    await open('blog/app/Posts/Index.alder');
    assert.equal(a.clients.roots().filter(r => r.endsWith('/blog')).length, 1, 'a second file reuses the client');
  });

  it('the server legend is the pinned legend', async () => {
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
      'vscode.provideDocumentSemanticTokensLegend', file('blog/app/Posts/Show.alder'));
    assert.deepEqual(legend.tokenTypes, [...TOKEN_TYPES]);
    assert.deepEqual(legend.tokenModifiers, [...TOKEN_MODIFIERS]);
  });

  it('tokens: tag at <article>, function+declaration at load', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', doc.uri);
    const toks = await until(async () => {
      const t = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', doc.uri);
      return t && t.data.length > 0 ? decode(t.data, legend) : undefined;
    }, 'semantic tokens');
    const tokAt = (p: vscode.Position) => toks.find(t => t.line === p.line && t.char === p.character);
    assert.equal(tokAt(at(doc, '<article>', 0, 1))?.type, 'tag');
    const load = tokAt(at(doc, '\nShow.load ', 0, 6));
    assert.equal(load?.type, 'function');
    assert.ok(load?.mods.includes('declaration'));
  });

  // folding and selection go straight to the root's server: VS Code's built-in indentation
  // folding and smart select would answer through the provider commands without it.
  it('the server folds load and the imports (kind imports, also through VS Code)', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const client = await serverOf(doc.uri);
    const loadLine = at(doc, '\nShow.load ', 0, 1).line;
    const first = at(doc, 'import Layout').line, last = at(doc, 'import Table.User').line;
    const folds = await client.sendRequest<FoldingRange[] | null>('textDocument/foldingRange', { textDocument: { uri: doc.uri.toString() } });
    assert.ok(folds?.some(f => (f.startLine === loadLine || f.startLine === loadLine + 1) && f.endLine > f.startLine + 5), JSON.stringify(folds));
    assert.ok(folds?.some(f => f.startLine === first && f.endLine === last && f.kind === 'imports'), JSON.stringify(folds));
    // built-in indentation folding has no kinds: an Imports range reached VS Code from alder
    const vs = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri);
    assert.ok(vs.some(f => f.start === first && f.end === last && f.kind === vscode.FoldingRangeKind.Imports), JSON.stringify(vs));
  });

  it('the server grows the selection through model.post.title, the attribute, the element, view, the module', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const client = await serverOf(doc.uri);
    const p = at(doc, '{model.post.title}>', 0, 12);
    const answer = await client.sendRequest<SelectionRange[] | null>('textDocument/selectionRange', {
      textDocument: { uri: doc.uri.toString() }, positions: [{ line: p.line, character: p.character }],
    });
    assert.equal(answer?.length, 1);
    const texts: string[] = [];
    for (let s: SelectionRange | undefined = answer![0]; s; s = s.parent) {
      const r = s.range;
      texts.push(doc.getText(new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character)));
    }
    assert.equal(texts.length, 5, JSON.stringify(texts));
    assert.equal(texts[0], 'model.post.title');
    assert.equal(texts[1], 'title={model.post.title}');
    assert.ok(texts[2].startsWith('<Layout.Page') && texts[2].endsWith('</Layout.Page>'), texts[2]);
    assert.ok(texts[3].startsWith('Show.view : Model'), texts[3]);
    assert.ok(texts[4].startsWith('module Posts.Show'), texts[4]);
  });

  it('two apps in one workspace get two clients, each document its own', async () => {
    await open('blog/app/App.alder');
    await open('fill/app/Helpers.alder');
    const a = await api();
    const roots = a.clients.roots();
    assert.ok(roots.some(r => r.endsWith('/blog')) && roots.some(r => r.endsWith('/fill')), roots.join(', '));
    const c1 = await a.clients.forUri(file('blog/app/App.alder'));
    const c2 = await a.clients.forUri(file('fill/app/Helpers.alder'));
    assert.ok(c1 && c2 && c1 !== c2);
    assert.ok(a.clients.statuses().every(s => s.running), JSON.stringify(a.clients.statuses()));
  });

  it('health names the binary, each running server, and the fill variables without values', async () => {
    const text = (await (await api()).health()).join('\n');
    assert.match(text, /^binary: \//m);
    assert.match(text, /ok: alder lsp running for .*\/blog/);
    assert.match(text, /ok: alder lsp running for .*\/fill/);
    assert.match(text, /ALDER_FILL_COMMAND: set/);
    assert.ok(!text.includes('Helpers.goLogin'));
  });
});
