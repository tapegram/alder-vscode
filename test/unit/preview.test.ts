import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHunk, render, RULE } from '../../src/generate/preview';

test('preview: files, rule, diff and holes', () => {
  const lines = render({
    files: [{ path: 'app/Posts/Index.alder', action: 'edited', added: 3, removed: 1 }, { path: 'app/New.alder', action: 'created', added: 9, removed: 0 }],
    diff: '--- a/app/Posts/Index.alder\n+++ b/app/Posts/Index.alder\n@@ -1 +1 @@\n-x\n+y\n',
    holes: [{ name: 'delete', type: 'Task Nav', module: 'Posts.Index', decl: 'update', file: 'app/Posts/Index.alder', line: 3, col: 5 }],
  });
  assert.equal(RULE, '─'.repeat(40));
  assert.deepEqual(lines, [
    '~ app/Posts/Index.alder  +3 −1', '+ app/New.alder', RULE,
    '--- a/app/Posts/Index.alder', '+++ b/app/Posts/Index.alder', '@@ -1 +1 @@', '-x', '+y',
    '? delete : Task Nav',
  ]);
  assert.equal(firstHunk(lines), 5);
});

test('preview: an error replaces everything; a removal is marked; no rule without a diff or holes', () => {
  assert.deepEqual(render({ error: 'line one\nline two', files: [] }), ['line one', 'line two']);
  const lines = render({ files: [{ path: 'app/Old.alder', action: 'removed', added: 0, removed: 12 }], diff: '' });
  assert.deepEqual(lines, ['- app/Old.alder']);
  assert.equal(firstHunk(lines), 0);
});

test('preview: nothing yet; null lists', () => {
  assert.deepEqual(render(undefined), []);
  assert.deepEqual(render(null), []);
  assert.deepEqual(render({ files: null, holes: null, diff: '' }), []);
});
