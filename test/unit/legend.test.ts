import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_TYPES, TOKEN_MODIFIERS, CUSTOM_TYPES } from '../../src/legend';
import pkg from '../../package.json';

test('the legend is alder internal/semtok, in order', () => {
  assert.deepEqual([...TOKEN_TYPES], ['namespace', 'type', 'enumMember', 'function', 'method', 'parameter',
    'variable', 'property', 'keyword', 'operator', 'string', 'number', 'comment', 'decorator', 'tag',
    'attribute', 'boolean', 'hole']);
  assert.deepEqual([...TOKEN_MODIFIERS], ['declaration', 'documentation', 'defaultLibrary']);
});

test('package.json declares each custom type with its superType and scope', () => {
  const declared = Object.fromEntries(pkg.contributes.semanticTokenTypes.map(t => [t.id, t.superType]));
  const scopes = pkg.contributes.semanticTokenScopes[0].scopes as Record<string, string[]>;
  assert.equal(pkg.contributes.semanticTokenScopes[0].language, 'alder');
  for (const [id, c] of Object.entries(CUSTOM_TYPES)) {
    assert.ok(TOKEN_TYPES.includes(id), `${id} is in the legend`);
    assert.equal(declared[id], c.superType, `${id} superType`);
    assert.deepEqual(scopes[id], [c.scope], `${id} scope`);
  }
  assert.equal(pkg.contributes.semanticTokenTypes.length, Object.keys(CUSTOM_TYPES).length);
});

test('package.json contributes the twelve Alder commands, each with a category', () => {
  const ids = pkg.contributes.commands.map(c => c.command).sort();
  assert.deepEqual(ids, ['alder.explainDiagnostic', 'alder.generate', 'alder.restartServer', 'alder.routes',
    'alder.run', 'alder.scratch.open', 'alder.scratch.openValue', 'alder.scratch.send', 'alder.showHealth',
    'alder.test.mutate', 'alder.test.run', 'alder.test.runAtCursor']);
  assert.ok(pkg.contributes.commands.every(c => c.category === 'Alder'));
  assert.ok(!ids.includes('alder.fill') && !ids.includes('alder.explain'), 'server commands are not contributed');
});
