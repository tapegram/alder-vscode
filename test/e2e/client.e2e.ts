import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, at, decode, file, open, until } from './helpers';
import { TOKEN_TYPES, TOKEN_MODIFIERS } from '../../src/legend';

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
    const load = tokAt(at(doc, '\nload ', 0, 1));
    assert.equal(load?.type, 'function');
    assert.ok(load?.mods.includes('declaration'));
  });

  it('folding folds load; selection grows through model.post.title', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const loadLine = at(doc, '\nload ', 0, 1).line;
    const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri);
    assert.ok(folds.some(f => (f.start === loadLine || f.start === loadLine + 1) && f.end > f.start + 5), JSON.stringify(folds));
    const p = at(doc, 'model.post.title', 0, 'model.post.'.length + 1);
    const [sel] = await vscode.commands.executeCommand<vscode.SelectionRange[]>('vscode.executeSelectionRangeProvider', doc.uri, [p]);
    const chain: vscode.Range[] = [];
    for (let s: vscode.SelectionRange | undefined = sel; s; s = s.parent) chain.push(s.range);
    assert.ok(chain.length >= 4, `chain of ${chain.length}`);
    assert.ok(chain[0].contains(p));
    for (let i = 1; i < chain.length; i++) assert.ok(chain[i].contains(chain[i - 1]) && !chain[i].isEqual(chain[i - 1]), `level ${i} grows`);
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
    assert.match(text, /ALDER_FILL_COMMAND: set/);
    assert.ok(!text.includes('Helpers.goLogin'));
  });
});
