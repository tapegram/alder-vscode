import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEditReply, editParams, isOldServer, normalizeCli, searchCliError, searchLabel, toItem, OLD_ALDER } from '../../src/searchItems';
import type { SearchResult } from '../../src/searchItems';
import type { CliResult } from '../../src/cli';

const std: SearchResult = { name: 'split', module: 'Text', kind: 'function', signature: 'Text -> Text -> List Text', doc: 'Split.\nMore.', source: 'stdlib' };
const cli = (o: Partial<CliResult>): CliResult => ({
  code: 0, signal: null, stdout: '', stderr: '', objects: [], json: undefined, cancelled: false, ...o,
});

test('label is Module.name, bare for Prelude', () => {
  assert.equal(searchLabel(std), 'Text.split');
  assert.equal(searchLabel({ ...std, module: 'Prelude', name: 'map' }), 'map');
});

test('item fields, alwaysShow, and the button only on app results', () => {
  const i = toItem(std);
  assert.equal(i.label, 'Text.split');
  assert.equal(i.description, 'Text -> Text -> List Text');
  assert.equal(i.detail, 'Split.');
  assert.equal(i.alwaysShow, true);
  assert.equal(i.buttons, undefined);
  assert.equal(toItem({ ...std, doc: '' }).detail, undefined);
  assert.equal(toItem({ ...std, source: 'app', file: '/p/a.alder' }).buttons?.length, 1);
  assert.equal(toItem({ ...std, source: 'app', uri: 'file:///p/a.alder' }).buttons?.length, 1);
});

test('normalizeCli makes file absolute and keeps 1-based line/col', () => {
  const out = JSON.stringify({ query: 'q', mode: 'name', note: 'n', results: [
    std, { ...std, source: 'app', file: 'app/A.alder', line: 3, col: 5 }] });
  const r = normalizeCli(out, '/proj');
  assert.equal(r.note, 'n');
  assert.equal(r.results[0].file, undefined);
  assert.deepEqual([r.results[1].file, r.results[1].line, r.results[1].col], ['/proj/app/A.alder', 3, 5]);
});

test('editParams keeps args: 0 and omits it when absent', () => {
  const pos = { line: 1, character: 2 };
  assert.deepEqual(editParams('file:///a', pos, { ...std, args: 0 }),
    { uri: 'file:///a', position: pos, module: 'Text', name: 'split', kind: 'function', args: 0 });
  assert.equal('args' in editParams('file:///a', pos, std), false);
});

test('checkEditReply needs a cursor', () => {
  const edit = { changes: {} };
  const cursor = { line: 0, character: 1 };
  assert.deepEqual(checkEditReply({ edit, cursor }), { edit, cursor });
  assert.deepEqual(checkEditReply({ edit }), { error: OLD_ALDER });
  assert.deepEqual(checkEditReply(null), { error: OLD_ALDER });
  assert.deepEqual(checkEditReply([]), { error: OLD_ALDER });
});

test('isOldServer is code -32601', () => {
  assert.equal(isOldServer({ code: -32601 }), true);
  assert.equal(isOldServer({ code: -32000 }), false);
  assert.equal(isOldServer(new Error('x')), false);
  assert.equal(isOldServer(null), false);
});

test('searchCliError: notes, old alder, other errors', () => {
  assert.deepEqual(searchCliError(cli({ code: 2, stderr: 'alder search: bad query\n' })), { note: 'bad query' });
  assert.deepEqual(searchCliError(cli({ code: 2, stderr: 'usage: alder search <query> [--json] [--limit N]\n' })),
    { note: 'usage: alder search <query> [--json] [--limit N]' });
  assert.deepEqual(searchCliError(cli({ code: 2, stderr: 'usage: alder <command> [arguments]\n' })), { error: OLD_ALDER });
  assert.deepEqual(searchCliError(cli({ code: 2, stderr: 'usage: alder routes\n' })), { error: OLD_ALDER });
  assert.deepEqual(searchCliError(cli({ code: 2, stderr: 'alder: unknown command "search"\n' })), { error: OLD_ALDER });
  assert.deepEqual(searchCliError(cli({ code: 1, stderr: 'boom\n' })), { error: 'alder search: boom' });
  assert.deepEqual(searchCliError(cli({ code: 2, stderr: '' }), 'Unhandled'), { error: 'alder search: ' });
});
