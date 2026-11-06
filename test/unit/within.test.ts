import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { within } from '../../src/generate/within';

test('within: the answer when it comes first, and the timer is cleared', async () => {
  const cleared = mock.method(globalThis, 'clearTimeout');
  try {
    assert.equal(await within(Promise.resolve(7), 5000), 7);
    assert.equal(cleared.mock.callCount(), 1);
  } finally {
    cleared.mock.restore();
  }
});

test('within: undefined after ms when the answer is late; a rejection still clears the timer', async () => {
  assert.equal(await within(new Promise<number>(() => {}), 5), undefined);
  const cleared = mock.method(globalThis, 'clearTimeout');
  try {
    await assert.rejects(within(Promise.reject(new Error('boom')), 5000), /boom/);
    assert.equal(cleared.mock.callCount(), 1);
  } finally {
    cleared.mock.restore();
  }
});
