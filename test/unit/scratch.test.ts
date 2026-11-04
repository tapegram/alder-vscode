import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docLines, fileLine, fullHint, needsHover, ScratchEntry, ScratchStore, watchAt, watchText } from '../../src/scratch';

test('the store keeps the last params per uri', () => {
  const s = new ScratchStore();
  s.record({ uri: 'file:///a', version: 1, watches: [{ line: 3, value: '2', type: 'Int' }] });
  s.record({ uri: 'file:///a', version: 2, watches: [] }, ['> 1']);
  s.record({ uri: 'file:///b', error: 'boom' });
  assert.equal(s.last('file:///a')?.version, 2);
  assert.deepEqual(s.entry('file:///a')?.lines, ['> 1']);
  assert.equal(s.last('file:///b')?.error, 'boom');
  assert.equal(s.last('file:///c'), undefined);
  s.clear();
  assert.equal(s.last('file:///a'), undefined);
});

test('a notification without a uri is ignored', () => {
  const s = new ScratchStore();
  const seen: string[] = [];
  s.onChange(u => seen.push(u));
  s.record({} as never);
  s.record(undefined as never);
  assert.equal(s.last('undefined'), undefined);
  assert.deepEqual(seen, []);
});

test('listeners hear record, forget and clear; the returned function unsubscribes', () => {
  const s = new ScratchStore();
  const seen: string[] = [];
  const off = s.onChange(u => seen.push(u));
  s.record({ uri: 'file:///a' });
  s.record({ uri: 'file:///b' });
  s.forget('file:///a');
  s.forget('file:///nope');
  s.clear();
  off();
  s.record({ uri: 'file:///c' });
  assert.deepEqual(seen, ['file:///a', 'file:///b', 'file:///a', 'file:///b']);
  assert.equal(s.entry('file:///a'), undefined);
});

test('docLines splits LF and CRLF alike', () => {
  assert.deepEqual(docLines('a\r\nb\n'), ['a', 'b', '']);
});

const entry = (lines: string[] | undefined): ScratchEntry => ({
  params: {
    uri: 'file:///s', version: 3, watches: [
      { line: 2, end: 2, value: '2', type: 'Int' },
      { line: 4, end: 5, value: '[1, 2]', type: 'List Int' },
    ],
  },
  lines,
});
const NOW = ['-- c', '> 1 + 1', '', '> [1,', '    2]', ''];

test('watchAt finds the watch whose lines hold the line', () => {
  const e = entry(NOW);
  assert.equal(watchAt(e, NOW, 2)?.value, '2');
  assert.equal(watchAt(e, NOW, 4)?.value, '[1, 2]');
  assert.equal(watchAt(e, NOW, 5)?.value, '[1, 2]');
  assert.equal(watchAt(e, NOW, 1), undefined);
  assert.equal(watchAt(e, NOW, 3), undefined);
  assert.equal(watchAt(e, NOW, 99), undefined);
});

test('a watch without end is one line', () => {
  const e: ScratchEntry = { params: { uri: 'u', watches: [{ line: 1, value: 'x' }] }, lines: ['> x'] };
  assert.equal(watchAt(e, ['> x'], 1)?.value, 'x');
  assert.equal(watchAt(e, ['> x', 'y'], 2), undefined);
});

test('no snapshot, no watch', () => {
  assert.equal(watchAt(entry(undefined), NOW, 2), undefined);
});

test('a changed or moved watch is not found', () => {
  const e = entry(NOW);
  const edited = ['-- c', '> 1 + 2', '', '> [1,', '    2]', ''];
  assert.equal(watchAt(e, edited, 2), undefined);
  assert.equal(watchAt(e, edited, 4)?.value, '[1, 2]');
  const moved = ['', ...NOW];
  assert.equal(watchAt(e, moved, 2), undefined);
  assert.equal(watchAt(e, moved, 3), undefined);
  assert.equal(watchAt(e, ['-- c'], 2), undefined);
});

test('watchText: error, else value and note, then the type', () => {
  assert.equal(watchText({ line: 1, error: 'boom\nmore', value: 'x', type: 'Int' }), 'boom\nmore\n: Int');
  assert.equal(watchText({ line: 1, value: '[1,\n 2]', type: 'List Int' }), '[1,\n 2]\n: List Int');
  assert.equal(watchText({ line: 1, value: '<Task>', note: 'not run: scratch evaluates pure values only', type: 'Task Int' }),
    '<Task>\nnot run: scratch evaluates pure values only\n: Task Int');
  assert.equal(watchText({ line: 1, note: 'n' }), 'n');
  assert.equal(watchText({ line: 1, type: 'Int' }), ': Int');
  assert.equal(watchText({ line: 1 }), '');
});

test('fullHint is the server\'s hintLabel without its cap', () => {
  assert.equal(fullHint({ line: 1, error: 'boom\nmore' }), '✗ boom');
  assert.equal(fullHint({ line: 1, value: '2', type: 'Int' }), '⇒ 2 : Int');
  assert.equal(fullHint({ line: 1, value: '[1,\n 2]', type: 'List Int' }), '⇒ [1, … : List Int');
  assert.equal(fullHint({ line: 1, value: 'x', truncated: true }), '⇒ x …');
  assert.equal(fullHint({ line: 1, type: 'Int' }), ': Int');
  assert.equal(fullHint({ line: 1, note: 'n' }), '');
});

test('needsHover when the hint cannot show it all', () => {
  assert.equal(needsHover({ line: 1, value: '2', type: 'Int' }), false);
  assert.equal(needsHover({ line: 1, value: '[1,\n 2]', type: 'List Int' }), true);
  assert.equal(needsHover({ line: 1, error: 'a\nb' }), true);
  assert.equal(needsHover({ line: 1, value: 'x', truncated: true }), true);
  assert.equal(needsHover({ line: 1, value: '<Task>', note: 'not run', type: 'Task Int' }), true);
  assert.equal(needsHover({ line: 1, value: 'x'.repeat(119) }), true); // "⇒ " + 119 = 121 code points: cut
  assert.equal(needsHover({ line: 1, value: 'x'.repeat(118) }), false); // 120: the server shows it whole
  assert.equal(needsHover({ line: 1 }), false);
});

test('fileLine: error, else note, else a warning not yet shown in another run', () => {
  assert.deepEqual(fileLine({ uri: 'u', version: 1, error: 'e1\ne2', note: 'n' }, undefined), { text: 'e1', kind: 'error', warning: false });
  assert.deepEqual(fileLine({ uri: 'u', version: 1, note: 'n', warning: 'w' }, undefined), { text: 'n', kind: 'note', warning: false });
  assert.deepEqual(fileLine({ uri: 'u', version: 1, warning: 'w' }, undefined), { text: 'w', kind: 'note', warning: true });
  assert.deepEqual(fileLine({ uri: 'u', version: 1, warning: 'w' }, 1), { text: 'w', kind: 'note', warning: true });
  assert.equal(fileLine({ uri: 'u', version: 2, warning: 'w' }, 1), undefined);
  assert.equal(fileLine({ uri: 'u', version: 1 }, undefined), undefined);
});
