import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScratchStore } from '../../src/scratch';

test('the store keeps the last params per uri', () => {
  const s = new ScratchStore();
  s.record({ uri: 'file:///a', version: 1, watches: [{ line: 3, value: '2', type: 'Int' }] });
  s.record({ uri: 'file:///a', version: 2, watches: [] });
  s.record({ uri: 'file:///b', error: 'boom' });
  assert.equal(s.last('file:///a')?.version, 2);
  assert.equal(s.last('file:///b')?.error, 'boom');
  assert.equal(s.last('file:///c'), undefined);
  s.clear();
  assert.equal(s.last('file:///a'), undefined);
});

test('a notification without a uri is ignored', () => {
  const s = new ScratchStore();
  s.record({} as never);
  assert.equal(s.last('undefined'), undefined);
});
