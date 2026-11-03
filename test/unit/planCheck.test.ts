import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedMessage, deletePrompt, firstRemoved, firstStale, landing, staleMessage } from '../../src/generate/planCheck';
import type { PlanFile, PlanResult } from '../../src/generate/types';

const files: PlanFile[] = [
  { path: 'app/A.alder', action: 'edited', before: 'a\n', after: 'A\n' },
  { path: 'app/New.alder', action: 'created', before: null, after: 'module New\n' },
  { path: 'app/Old.alder', action: 'removed', before: 'old\n', after: null },
];

test('planCheck: firstStale compares every file with its before; a created file must not exist', async () => {
  const disk: Record<string, string | null> = { 'app/A.alder': 'a\n', 'app/New.alder': null, 'app/Old.alder': 'old\n' };
  assert.equal(await firstStale(files, async p => disk[p] ?? null), undefined);
  assert.equal(await firstStale(files, async p => (p === 'app/A.alder' ? 'typed\n' : disk[p] ?? null)), 'app/A.alder');
  assert.equal(await firstStale(files, async p => (p === 'app/New.alder' ? '' : disk[p] ?? null)), 'app/New.alder');
});

test('planCheck: firstRemoved and the messages', () => {
  assert.equal(firstRemoved(files), 'app/Old.alder');
  assert.equal(firstRemoved(files.slice(0, 2)), undefined);
  assert.equal(staleMessage('app/A.alder'), 'alder: app/A.alder changed since planning; nothing applied');
  assert.equal(deletePrompt('app/Old.alder'), 'Delete app/Old.alder from disk? undo cannot restore it');
  const plan: PlanResult = { files, holes: [] };
  assert.equal(appliedMessage('remove page', plan), 'alder: applied remove page: app/A.alder, app/New.alder, app/Old.alder');
  const hole = { name: 'h', type: 'Int', module: 'A', decl: 'view', file: 'app/A.alder', line: 4, col: 7 };
  assert.equal(appliedMessage('new msg', { files: files.slice(0, 1), holes: [hole] }), 'alder: applied new msg: app/A.alder (1 hole)');
  assert.equal(appliedMessage('new msg', { files: files.slice(0, 1), holes: [hole, hole] }), 'alder: applied new msg: app/A.alder (2 holes)');
});

test('planCheck: landing is the first hole, else the first created .alder file, else the first edited one not active', () => {
  const hole = { name: 'h', type: 'Int', module: 'A', decl: 'view', file: 'app/A.alder', line: 4, col: 7 };
  assert.deepEqual(landing({ files, holes: [hole] }), { kind: 'hole', file: 'app/A.alder', line: 3, col: 6 });
  assert.deepEqual(landing({ files, holes: [{ ...hole, col: 0 }] }), { kind: 'hole', file: 'app/A.alder', line: 3, col: 0 });
  assert.deepEqual(landing({ files, holes: [] }), { kind: 'file', path: 'app/New.alder' });
  const edited: PlanFile[] = [files[0], { path: 'app/B.alder', action: 'edited', before: 'b', after: 'B' }];
  assert.deepEqual(landing({ files: edited }), { kind: 'file', path: 'app/A.alder' });
  assert.deepEqual(landing({ files: edited }, 'app/A.alder'), { kind: 'file', path: 'app/B.alder' });
  assert.equal(landing({ files: [files[0]] }, 'app/A.alder'), undefined);
  assert.equal(landing({ files: [{ path: 'db/x.sql', action: 'created', before: null, after: '' }] }), undefined);
});
