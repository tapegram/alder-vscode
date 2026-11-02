import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vsctm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

const root = join(__dirname, '../../..');
const wasm = readFileSync(join(root, 'node_modules/vscode-oniguruma/release/onig.wasm')).buffer;
const onig = oniguruma.loadWASM(wasm).then(() => ({
  createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p),
  createOnigString: (s: string) => new oniguruma.OnigString(s),
}));
const registry = new vsctm.Registry({
  onigLib: onig,
  loadGrammar: async () => vsctm.parseRawGrammar(
    readFileSync(join(root, 'syntaxes/alder.tmLanguage.json'), 'utf8'), 'alder.tmLanguage.json'),
});

// scopesOf tokenizes one line and returns, for each token text, its innermost scope.
async function scopesOf(line: string): Promise<[string, string][]> {
  const g = await registry.loadGrammar('source.alder');
  assert.ok(g);
  const r = g.tokenizeLine(line, vsctm.INITIAL);
  return r.tokens.map(t => [line.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]]);
}
async function scopeOf(line: string, text: string): Promise<string | undefined> {
  return (await scopesOf(line)).find(([t]) => t === text)?.[1];
}

test('comments swallow quotes', async () => {
  assert.equal(await scopeOf('-- a comment with "quotes"', '-- a comment with "quotes"'), 'comment.line.double-dash.alder');
});

test('a string with an interpolation embeds it', async () => {
  const s = await scopesOf('x = "a {b} c"');
  assert.ok(s.some(([t, sc]) => t === '"' && sc.startsWith('string.quoted.double')));
  const b = (await registry.loadGrammar('source.alder'))!.tokenizeLine('x = "a {b} c"', vsctm.INITIAL)
    .tokens.find(t => t.startIndex === 8)!;
  assert.ok(b.scopes.includes('meta.embedded.interpolation.alder'), b.scopes.join(' '));
});

test('keywords by family', async () => {
  assert.equal(await scopeOf('module Posts.Show', 'module'), 'keyword.control.import.alder');
  assert.equal(await scopeOf('import Layout as L', 'as'), 'keyword.control.import.alder');
  assert.equal(await scopeOf('type Model = {', 'type'), 'storage.type.alder');
  assert.equal(await scopeOf('page "/posts/{slug}" { slug: Post.Slug }', 'page'), 'storage.type.alder');
  assert.equal(await scopeOf('deploy fly {', 'deploy'), 'storage.type.alder');
  assert.equal(await scopeOf('  if a then b else c', 'if'), 'keyword.control.conditional.alder');
  assert.equal(await scopeOf('  match found {', 'match'), 'keyword.control.conditional.alder');
  assert.equal(await scopeOf('  for p in posts', 'for'), 'keyword.control.loop.alder');
  assert.equal(await scopeOf('  let x = 1', 'let'), 'keyword.other.alder');
});

test('comparison is an operator, not a tag; ?? is not a hole', async () => {
  assert.equal(await scopeOf('a < b', '<'), 'keyword.operator.alder');
  assert.equal(await scopeOf('x ?? y', '??'), 'keyword.operator.alder');
  assert.equal(await scopeOf('  ?out', '?out'), 'variable.language.hole.alder');
});

test('numbers, booleans, brackets', async () => {
  assert.equal(await scopeOf('x = 42', '42'), 'constant.numeric.alder');
  assert.equal(await scopeOf('x = 1.5', '1.5'), 'constant.numeric.alder');
  assert.equal(await scopeOf('x = True', 'True'), 'constant.language.boolean.alder');
  assert.equal(await scopeOf('f (x)', '('), 'punctuation.bracket.alder');
});

test('a tag and its attribute, by shape', async () => {
  const line = '<Layout.Page title={t}>';
  assert.equal(await scopeOf(line, 'Layout.Page'), 'entity.name.tag.alder');
  assert.equal(await scopeOf(line, 'title'), 'entity.other.attribute-name.alder');
  assert.equal(await scopeOf('</article>', 'article'), 'entity.name.tag.alder');
  const gt = await scopesOf('<p class={if a > b then "x" else "y"}>');
  assert.ok(gt.some(([t, sc]) => t === '>' && sc === 'keyword.operator.alder'), 'a > b inside braces stays an operator');
});
