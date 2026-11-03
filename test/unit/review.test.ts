import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewModel } from '../../src/generate/review';

test('review: notes and files', () => {
  const m = reviewModel({
    files: [
      { path: 'app/Posts/Index.alder', action: 'edited', before: 'a\nb\n', after: 'a\nB\n' },
      { path: 'app/New.alder', action: 'created', before: null, after: 'module New\n' },
      { path: 'app/Old.alder', action: 'removed', before: 'module Old\n', after: null },
    ],
    holes: [{ name: 'delete', type: 'Task Nav', module: 'Posts.Index', decl: 'update', arm: 'Delete', file: 'app/Posts/Index.alder', line: 1, col: 1 },
      { name: 'x', type: 'Int', module: 'A', decl: 'view', file: 'app/A.alder', line: 1, col: 1 }],
    imports: ['Post'],
    migration: ['add column note'],
    diagnostics: [],
    error: '',
  });
  assert.equal(m.canApply, true);
  assert.deepEqual(m.notes, ['? delete : Task Nav  (Posts.Index.update.Delete)', '? x : Int  (A.view)', 'import Post', 'migration: add column note']);
  assert.deepEqual(m.files.map(f => [f.mark, f.path, f.before, f.after]), [
    ['~', 'app/Posts/Index.alder', 'a\nb\n', 'a\nB\n'],
    ['+', 'app/New.alder', '', 'module New\n'],
    ['-', 'app/Old.alder', 'module Old\n', ''],
  ]);
});

test('review: an error forbids applying and heads the notes', () => {
  const m = reviewModel({ error: 'the result does not check', diagnostics: [{ file: 'app/X.alder', line: 3, col: 1, code: 'E0003', message: 'expected Int', severity: 'error' }], files: [] });
  assert.equal(m.canApply, false);
  assert.deepEqual(m.notes, ['✗ the result does not check', 'app/X.alder:3:1 E0003 expected Int']);
});

test('review: absent and null fields are fine', () => {
  assert.deepEqual(reviewModel(null), { notes: [], files: [], canApply: true });
  assert.deepEqual(reviewModel({ files: null, holes: null, imports: null, migration: null, diagnostics: null }), { notes: [], files: [], canApply: true });
});
