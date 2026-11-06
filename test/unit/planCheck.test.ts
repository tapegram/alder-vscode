import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedMessage, changedPaths, deletePrompt, emptyDirs, removedPaths, firstStale, failedMessage, landing, seenText, staleMessage } from '../../src/generate/planCheck';
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

test('planCheck: removedPaths and the messages', () => {
  assert.deepEqual(removedPaths(files), ['app/Old.alder']);
  assert.deepEqual(removedPaths(files.slice(0, 2)), []);
  const two: PlanFile = { path: 'app/Old2.alder', action: 'removed', before: 'old2\n', after: null };
  assert.deepEqual(removedPaths([...files, two]), ['app/Old.alder', 'app/Old2.alder']);
  assert.equal(staleMessage('app/A.alder'), 'alder: app/A.alder changed since planning; nothing applied');
  assert.equal(deletePrompt(['app/Old.alder'], false), 'Delete app/Old.alder from disk? undo cannot restore it');
  assert.equal(deletePrompt(['app/Old.alder', 'app/Old2.alder'], false), 'Delete app/Old.alder, app/Old2.alder from disk? undo cannot restore it');
  // files.enableTrash: the file goes to the trash, and undo can restore it
  assert.equal(deletePrompt(['app/Old.alder'], true), 'Delete app/Old.alder? it goes to the trash; undo can restore it');
  assert.equal(deletePrompt(['app/Old.alder', 'app/Old2.alder'], true), 'Delete app/Old.alder, app/Old2.alder? they go to the trash; undo can restore them');
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

test('planCheck: seenText is a dirty document\'s text; a clean one for a file gone from disk reads as missing', () => {
  assert.equal(seenText({ dirty: true, text: 'typed' }, null), 'typed');
  assert.equal(seenText({ dirty: true, text: 'typed' }, 'disk'), 'typed');
  // a clean document whose file is gone (deleted, or a created file reverted and removed) is stale
  assert.equal(seenText({ dirty: false, text: 'old' }, null), null);
  assert.equal(seenText({ dirty: false, text: '' }, null), null);
  assert.equal(seenText({ dirty: false, text: 'doc' }, 'disk'), 'doc');
  assert.equal(seenText(undefined, 'disk'), 'disk');
  assert.equal(seenText(undefined, null), null);
});

test('planCheck: emptyDirs are a removed file\'s folders up to app/, innermost first', () => {
  assert.deepEqual(emptyDirs('app/Tags/Index.alder'), ['app/Tags']);
  assert.deepEqual(emptyDirs('app/Sites/Clarity/Index.alder'), ['app/Sites/Clarity', 'app/Sites']);
  assert.deepEqual(emptyDirs('app/Index.alder'), []);
  assert.deepEqual(emptyDirs('Index.alder'), []);
  assert.deepEqual(emptyDirs('db/x.sql'), ['db']);
});

test('planCheck: after a failed apply, changedPaths are the files no longer as planned; the message names them', async () => {
  const disk: Record<string, string | null> = { 'app/A.alder': 'a\n', 'app/New.alder': null, 'app/Old.alder': 'old\n' };
  assert.deepEqual(await changedPaths(files, async p => disk[p] ?? null), []);
  const half: Record<string, string | null> = { 'app/A.alder': 'A\n', 'app/New.alder': '', 'app/Old.alder': 'old\n' };
  assert.deepEqual(await changedPaths(files, async p => half[p] ?? null), ['app/A.alder', 'app/New.alder']);
  assert.deepEqual(await changedPaths(files, async p => (p === 'app/Old.alder' ? null : disk[p] ?? null)), ['app/Old.alder']);
  assert.equal(failedMessage('new page', []), 'alder: new page could not be applied; nothing applied');
  assert.equal(failedMessage('new page', ['app/A.alder', 'app/New.alder']),
    'alder: new page could not be applied in full; these files changed: app/A.alder, app/New.alder');
});
